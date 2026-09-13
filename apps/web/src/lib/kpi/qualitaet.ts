import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, rpcAlle, takt } from "@/lib/kpi/gemeinsam";

/**
 * Audit-Findings. Rechenweg in Alembic 0006.
 *
 * Gezählt werden Zeilen, nicht Mengen: ein Befund ist ein Befund, unabhängig
 * davon, wie viele Teile betroffen sind. Das Level steht in der Quelldatei
 * nicht in einer Spalte, sondern im Freitext; wo es nicht zu erkennen war,
 * zählt die Zeile nirgends und taucht in der Diagnoseliste auf. Liste und
 * Diagnoseliste in Alembic 0044.
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

/** Eine Zeile der Findings-Übersicht (QUA-07). */
export interface AuditFinding {
  report_nr: string;
  report_date: string;
  art: string | null;
  level: 1 | 2 | null;
  issuer: string | null;
  customer_name: string | null;
  customer_id: string | null;
  designation: string | null;
  status_code: string | null;
}

/** Die vier Audit-Codes, wie sie in der Quelldatei stehen. */
export const AUDIT_ARTEN = ["BH AUD", "EX AUD", "IN AUD", "KU AUD"] as const;

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
  liste: (von: string | null, bis: string | null, arten: string[] | null) =>
    // Vollständig, nicht nur die ersten 1000 Zeilen von PostgREST.
    rpcAlle<AuditFinding>("kpi_qualitaet_audits_liste", { von, bis, arten }),
};

/** Die Befunde ohne erkanntes Level — aus derselben Menge wie die Übersicht,
 *  damit Diagnoseliste und Kachel „Ohne erkennbares Level“ nie auseinanderlaufen. */
export function ohneLevel(liste: readonly AuditFinding[]): AuditFinding[] {
  return liste.filter((z) => z.level == null);
}

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

/** Eine Zeile der Reklamationstabelle (QUA-08). */
export interface ReklamationZeile {
  report_nr: string;
  report_date: string;
  customer_name: string | null;
  customer_id: string | null;
  designation: string | null;
  quantity: number | null;
  accepted_quantity: number | null;
  issuer: string | null;
  status_code: string | null;
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
  liste: async (p_art: ReklamationsArt, von: string | null, bis: string | null): Promise<ReklamationZeile[]> => {
    const rows = await rpcAlle<ReklamationZeile>("kpi_qualitaet_reklamationen_liste", { p_art, von, bis });
    return rows.map((r) => ({
      ...r,
      quantity: r.quantity == null ? null : Number(r.quantity),
      accepted_quantity: r.accepted_quantity == null ? null : Number(r.accepted_quantity),
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

/**
 * Prüfleistung: geprüfte Menge je Prüfer-Tag. Rechenweg in Alembic 0044 —
 * jede Größe teilt durch die Prüfer-Tage, an denen sie geprüft wurde, Gesamt
 * durch alle. Groß und klein ergeben zusammen deshalb nicht Gesamt.
 */
export type Artikelart = "fertig" | "halbfertig" | "alle";
export type Pruefklasse = "gross" | "klein" | "gesamt";
export const PRUEFKLASSEN: readonly Pruefklasse[] = ["gross", "klein", "gesamt"];

export interface Pruefmengen {
  gross: number;
  klein: number;
  gesamt: number;
  personentage_gross: number;
  personentage_klein: number;
  personentage_gesamt: number;
}

export interface PruefVerlaufPunkt extends Pruefmengen {
  bucket: string;
}

function alsPruefmengen(roh: Partial<Record<keyof Pruefmengen, unknown>> | undefined): Pruefmengen {
  return {
    gross: Number(roh?.gross ?? 0),
    klein: Number(roh?.klein ?? 0),
    gesamt: Number(roh?.gesamt ?? 0),
    personentage_gross: Number(roh?.personentage_gross ?? 0),
    personentage_klein: Number(roh?.personentage_klein ?? 0),
    personentage_gesamt: Number(roh?.personentage_gesamt ?? 0),
  };
}

/** Der Wert für die Vergleichszeilen. Ohne Prüfer-Tage im Vergleichsfenster
 *  steht in der Kachel zwar 0, aber es gibt nichts zu vergleichen. */
export function pruefleistungVergleich(m: Pruefmengen | undefined, klasse: Pruefklasse): number | null {
  if (!m || m[`personentage_${klasse}`] === 0) return null;
  return m[klasse];
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
  artikel: string | null;
  bezeichnung: string | null;
  size_class: "large" | "small";
  buchungs_menge: number | null;
  ausschuss_menge: number | null;
  excluded: boolean;
}

export const pruefungApi = {
  mengen: async (von: string | null, bis: string | null, artikelart: Artikelart): Promise<Pruefmengen> => {
    const rows = await rpc<Pruefmengen[]>("kpi_qualitaet_pruefmengen", { von, bis, artikelart });
    return alsPruefmengen(rows[0]);
  },
  verlauf: async (von: string | null, bis: string | null, artikelart: Artikelart): Promise<PruefVerlaufPunkt[]> => {
    const rows = await rpc<PruefVerlaufPunkt[]>("kpi_qualitaet_pruefmengen_verlauf", {
      von,
      bis,
      takt: takt(von, bis),
      artikelart,
    });
    return rows.map((r) => ({ bucket: r.bucket, ...alsPruefmengen(r) }));
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
  buchungen: async (von: string | null, bis: string | null, artikelart: Artikelart) => {
    const rows = await rpcAlle<BuchungsZeile>("kpi_qualitaet_buchungen", { von, bis, artikelart });
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
