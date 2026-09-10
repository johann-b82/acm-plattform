import { rpc, takt } from "@/lib/kpi/gemeinsam";

/**
 * Materialkostenquote. Rechenweg in Alembic 0010.
 *
 * Die Preisliste ist eine Sicht auf die Wareneingänge und gilt unabhängig
 * vom gewählten Zeitraum: auch der Januar wird mit dem jüngsten bekannten
 * Preis bewertet. So rechnet das Altprojekt, und eine Änderung daran wäre
 * eine fachliche Entscheidung, keine technische.
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
  /** Zusammengefasste Kleinabteilungen — die Zeile ist kein einzelnes Gehalt. */
  gebuendelt: boolean;
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

  personalkostenJeAbteilung: async (von: string, bis: string) => {
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

  verbrauch: async (von: string | null, bis: string | null, grenze = 500) => {
    const rows = await rpc<VerbrauchZeile[]>("kpi_finanzen_materialverbrauch", { von, bis, grenze });
    return rows.map((z) => ({
      ...z,
      menge: zahl(z.menge),
      stueckpreis: z.stueckpreis == null ? null : Number(z.stueckpreis),
      kosten: z.kosten == null ? null : Number(z.kosten),
    }));
  },
};
