import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, takt } from "@/lib/kpi/gemeinsam";

/**
 * Audit-Findings. Rechenweg in Alembic 0006.
 *
 * Gezählt werden Zeilen, nicht Mengen: ein Befund ist ein Befund, unabhängig
 * davon, wie viele Teile betroffen sind. Das Level steht in der Quelldatei
 * nicht in einer Spalte, sondern im Freitext; wo es nicht zu erkennen war,
 * zählt die Zeile nirgends und taucht in der Diagnoseliste auf.
 */

export interface AuditSumme {
  level_1: number;
  level_2: number;
  ohne_level: number;
}

export interface AuditVerlaufZeile {
  bucket: string;
  art: string;
  level_1: number;
  level_2: number;
}

export interface AuditOhneLevel {
  report_nr: string;
  report_date: string;
  art: string | null;
  customer_name: string | null;
  designation: string | null;
}

/** Die vier Audit-Codes, wie sie in der Quelldatei stehen. */
export const AUDIT_ARTEN = ["BH AUD", "EX AUD", "IN AUD", "KU AUD"] as const;

export const AUDIT_LABEL: Record<string, string> = {
  "BH AUD": "Behörde",
  "EX AUD": "Extern",
  "IN AUD": "Intern",
  "KU AUD": "Kunde",
};

export const qualitaetApi = {
  audits: async (von: string | null, bis: string | null, arten: string[] | null): Promise<AuditSumme> => {
    const rows = await rpc<AuditSumme[]>("kpi_qualitaet_audits", { von, bis, arten });
    return rows[0] ?? { level_1: 0, level_2: 0, ohne_level: 0 };
  },
  verlauf: (von: string | null, bis: string | null, arten: string[] | null) =>
    rpc<AuditVerlaufZeile[]>("kpi_qualitaet_audits_verlauf", {
      von,
      bis,
      takt: takt(von, bis),
      arten,
    }),
  ohneLevel: (von: string | null, bis: string | null, arten: string[] | null, grenze = 500) =>
    rpc<AuditOhneLevel[]>("kpi_qualitaet_audits_ohne_level", { von, bis, grenze, arten }),
};

/**
 * Die nach Art aufgeschlüsselten Verlaufszeilen zu einem Punkt je Bucket
 * zusammenfassen. Die Summe der Aufschlüsselung ist der Bucket-Gesamtwert.
 */
export function verlaufJeBucket(
  zeilen: readonly AuditVerlaufZeile[],
): { bucket: string; level_1: number; level_2: number }[] {
  const nach = new Map<string, { bucket: string; level_1: number; level_2: number }>();
  for (const z of zeilen) {
    const eintrag = nach.get(z.bucket) ?? { bucket: z.bucket, level_1: 0, level_2: 0 };
    eintrag.level_1 += Number(z.level_1);
    eintrag.level_2 += Number(z.level_2);
    nach.set(z.bucket, eintrag);
  }
  return [...nach.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// ---------------------------------------------------------------------------
// Reklamationsquote (On Quality)
// ---------------------------------------------------------------------------

export type ReklamationsArt = "kunde" | "intern" | "lieferant" | "werkbank";
export type Mengenart = "gesamt" | "akzeptiert";

export const REKLAMATION_LABEL: Record<ReklamationsArt, string> = {
  kunde: "Kunde",
  intern: "intern",
  lieferant: "Material-Lieferanten",
  werkbank: "Werkbänke",
};

/** Bezugsgröße je Art — steht in der Kachel, sonst rät man. */
export const REKLAMATION_BEZUG: Record<ReklamationsArt, string> = {
  kunde: "gelieferte Menge",
  intern: "gelieferte Menge",
  lieferant: "Wareneingang ohne Dienstleistung",
  werkbank: "Wareneingang der Warengruppen DIENST und SERVIC",
};

export const MENGENART_LABEL: Record<Mengenart, string> = {
  gesamt: "gemeldete Menge",
  akzeptiert: "akzeptierte Menge",
};

export interface ReklamationSumme {
  quote: number | null;
  reklamiert: number;
  bezugsmenge: number;
}

export interface ReklamationVerlaufPunkt {
  bucket: string;
  quote: number | null;
  reklamiert: number;
  bezugsmenge: number;
}

export const reklamationApi = {
  quote: async (
    p_art: ReklamationsArt,
    p_mengenart: Mengenart,
    von: string | null,
    bis: string | null,
  ): Promise<ReklamationSumme> => {
    const rows = await rpc<ReklamationSumme[]>("kpi_qualitaet_reklamationen", {
      p_art,
      p_mengenart,
      von,
      bis,
    });
    const roh = rows[0];
    return roh
      ? {
          quote: roh.quote == null ? null : Number(roh.quote),
          reklamiert: Number(roh.reklamiert),
          bezugsmenge: Number(roh.bezugsmenge),
        }
      : { quote: null, reklamiert: 0, bezugsmenge: 0 };
  },
  verlauf: async (
    p_art: ReklamationsArt,
    p_mengenart: Mengenart,
    von: string | null,
    bis: string | null,
  ): Promise<ReklamationVerlaufPunkt[]> => {
    const rows = await rpc<ReklamationVerlaufPunkt[]>("kpi_qualitaet_reklamationen_verlauf", {
      p_art,
      p_mengenart,
      von,
      bis,
      takt: takt(von, bis),
    });
    return rows.map((r) => ({
      ...r,
      quote: r.quote == null ? null : Number(r.quote),
      reklamiert: Number(r.reklamiert),
      bezugsmenge: Number(r.bezugsmenge),
    }));
  },
};

/**
 * „On Quality" ist das Gegenstück zur Fehlerquote. Die Datenbank liefert die
 * Fehlerquote, weil sie sich direkt aus Zähler und Nenner ergibt; die
 * Umkehrung passiert hier, an einer Stelle.
 */
export function onQuality(fehlerquote: number | null): number | null {
  return fehlerquote == null ? null : 1 - fehlerquote;
}

// ---------------------------------------------------------------------------
// Prüfmengen und Ausschussquote
// ---------------------------------------------------------------------------

export interface Pruefmengen {
  gross: number;
  klein: number;
  pruefer: number;
  prueftage: number;
}

export interface AusschussZeile {
  bezeichnung: string | null;
  size_class: "large" | "small";
  buchungs_menge: number;
  ausschuss_menge: number | null;
  quote: number | null;
}

export interface BuchungsZeile {
  id: number;
  pruef_datum: string;
  benutzer: string | null;
  bezeichnung: string | null;
  size_class: "large" | "small";
  buchungs_menge: number | null;
  ausschuss_menge: number | null;
  excluded: boolean;
}

export const KLASSE_LABEL: Record<"large" | "small", string> = {
  large: "groß",
  small: "klein",
};

export const pruefungApi = {
  mengen: async (von: string | null, bis: string | null): Promise<Pruefmengen> => {
    const rows = await rpc<Pruefmengen[]>("kpi_qualitaet_pruefmengen", { von, bis });
    const roh = rows[0];
    return roh
      ? {
          gross: Number(roh.gross),
          klein: Number(roh.klein),
          pruefer: Number(roh.pruefer),
          prueftage: Number(roh.prueftage),
        }
      : { gross: 0, klein: 0, pruefer: 0, prueftage: 0 };
  },
  ausschuss: async (von: string | null, bis: string | null, grenze = 500) => {
    const rows = await rpc<AusschussZeile[]>("kpi_qualitaet_ausschuss", { von, bis, grenze });
    return rows.map((z) => ({
      ...z,
      buchungs_menge: Number(z.buchungs_menge),
      ausschuss_menge: z.ausschuss_menge == null ? null : Number(z.ausschuss_menge),
      quote: z.quote == null ? null : Number(z.quote),
    }));
  },
  buchungen: async (von: string | null, bis: string | null, grenze = 500) => {
    const rows = await rpc<BuchungsZeile[]>("kpi_qualitaet_buchungen", { von, bis, grenze });
    return rows.map((z) => ({
      ...z,
      buchungs_menge: z.buchungs_menge == null ? null : Number(z.buchungs_menge),
      ausschuss_menge: z.ausschuss_menge == null ? null : Number(z.ausschuss_menge),
    }));
  },
  /** Eine Buchung aus den Kennzahlen nehmen oder wieder aufnehmen. */
  ausschlussSetzen: async (id: number, excluded: boolean): Promise<void> => {
    const { error } = await supabaseBrowser()
      .from("inspection_records")
      .update({ excluded })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },
};
