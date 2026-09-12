import { rpc, takt } from "@/lib/kpi/gemeinsam";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Materialkostenquote. Rechenweg in Alembic 0010, Preisquelle seit 0043.
 *
 * Die Preise kommen aus dem eigenen Import „Materialpreise (Wareneingang)"
 * und gelten unabhängig vom gewählten Zeitraum: auch der Januar wird mit dem
 * jüngsten bekannten Preis bewertet. So rechnet das Altprojekt, und eine
 * Änderung daran wäre eine fachliche Entscheidung, keine technische.
 */

export interface MaterialkostenSumme {
  quote: number | null;
  materialkosten: number;
  umsatz: number;
  ohne_preis: number;
}

export interface MaterialkostenVerlaufPunkt {
  bucket: string;
  quote: number | null;
  materialkosten: number;
  umsatz: number;
}

export interface VerbrauchZeile {
  artikelnr: string;
  article_name: string | null;
  menge: number;
  stueckpreis: number | null;
  kosten: number | null;
}

function zahl(v: unknown): number {
  return v == null ? 0 : Number(v);
}

export interface PersonalkostenSumme {
  personalkosten: number;
  umsatz: number;
  quote: number | null;
  personen: number;
}

export interface PersonalkostenAbteilung {
  abteilung: string;
  kosten: number;
  personen: number;
}

export interface PersonalkostenVerlaufPunkt {
  bucket: string;
  quote: number | null;
  personalkosten: number;
  umsatz: number;
}

/** So viele Zeilen gibt PostgREST höchstens auf einmal heraus. */
const SEITE = 1000;

/**
 * Eine Tabellenfunktion vollständig laden, Seite für Seite. Die Funktion muss
 * eindeutig sortieren — sonst stünde eine Zeile über die Seitengrenze hinweg
 * doppelt oder gar nicht da.
 */
async function alleZeilen<T>(name: string, args: Record<string, unknown>): Promise<T[]> {
  const alle: T[] = [];
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await supabaseBrowser().rpc(name, args).range(von, von + SEITE - 1);
    if (error) throw new Error(error.message);
    const teil = (data ?? []) as T[];
    alle.push(...teil);
    if (teil.length < SEITE) return alle;
  }
}

export const finanzenApi = {
  materialkosten: async (von: string | null, bis: string | null): Promise<MaterialkostenSumme> => {
    const rows = await rpc<MaterialkostenSumme[]>("kpi_finanzen_materialkosten", { von, bis });
    const roh = rows[0];
    return roh
      ? {
          quote: roh.quote == null ? null : Number(roh.quote),
          materialkosten: zahl(roh.materialkosten),
          umsatz: zahl(roh.umsatz),
          ohne_preis: zahl(roh.ohne_preis),
        }
      : { quote: null, materialkosten: 0, umsatz: 0, ohne_preis: 0 };
  },
  verlauf: async (von: string | null, bis: string | null) => {
    const rows = await rpc<MaterialkostenVerlaufPunkt[]>("kpi_finanzen_materialkosten_verlauf", {
      von,
      bis,
      takt: takt(von, bis),
    });
    return rows.map((r) => ({
      ...r,
      quote: r.quote == null ? null : Number(r.quote),
      materialkosten: zahl(r.materialkosten),
      umsatz: zahl(r.umsatz),
    }));
  },
  /**
   * Personalkostenquote. Rechenweg in Alembic 0014.
   *
   * Braucht ein Fenster: die anteilige Verteilung des Monatsbruttos hat ohne
   * Grenzen keinen Sinn. Der Zeitraum „Alles" ruft sie deshalb nicht.
   */
  personalkosten: async (von: string, bis: string): Promise<PersonalkostenSumme> => {
    const rows = await rpc<PersonalkostenSumme[]>("kpi_finanzen_personalkosten", {
      p_von: von,
      p_bis: bis,
    });
    const r = rows[0];
    return {
      personalkosten: zahl(r?.personalkosten),
      umsatz: zahl(r?.umsatz),
      quote: r?.quote == null ? null : Number(r.quote),
      personen: zahl(r?.personen),
    };
  },

  /** Jede Abteilung einzeln (FIN-05) — nur Summen, nie eine Person. */
  personalkostenJeAbteilung: async (von: string, bis: string): Promise<PersonalkostenAbteilung[]> => {
    const rows = await rpc<PersonalkostenAbteilung[]>(
      "kpi_finanzen_personalkosten_abteilung",
      { p_von: von, p_bis: bis },
    );
    return rows.map((z) => ({
      ...z,
      kosten: zahl(z.kosten),
      personen: zahl(z.personen),
    }));
  },

  personalVerlauf: async (von: string, bis: string): Promise<PersonalkostenVerlaufPunkt[]> => {
    const rows = await rpc<PersonalkostenVerlaufPunkt[]>("kpi_finanzen_personalkosten_verlauf", {
      p_von: von,
      p_bis: bis,
      p_takt: takt(von, bis),
    });
    return rows.map((r) => ({
      ...r,
      quote: r.quote == null ? null : Number(r.quote),
      personalkosten: zahl(r.personalkosten),
      umsatz: zahl(r.umsatz),
    }));
  },

  /** Die ganze Prüftabelle, ohne Zeilengrenze; die Tabelle blättert selbst. */
  verbrauch: async (von: string | null, bis: string | null): Promise<VerbrauchZeile[]> => {
    const rows = await alleZeilen<VerbrauchZeile>("kpi_finanzen_materialverbrauch", { von, bis });
    return rows.map((z) => ({
      ...z,
      menge: zahl(z.menge),
      stueckpreis: z.stueckpreis == null ? null : Number(z.stueckpreis),
      kosten: z.kosten == null ? null : Number(z.kosten),
    }));
  },
};
