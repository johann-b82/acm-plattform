import { rpc, takt } from "@/lib/kpi/gemeinsam";

/**
 * Liefertermintreue der Lieferanten (OTD). Rechenweg in Alembic 0004.
 *
 * Das Fenster liegt auf dem Ist-Lieferdatum, nicht auf dem Zieltermin: gezählt
 * wird, was im Zeitraum angekommen ist.
 */

export interface OtdSumme {
  quote: number | null;
  puenktlich: number;
  gesamt: number;
  verzug_schnitt: number | null;
}

export interface OtdVerlaufPunkt {
  bucket: string;
  quote: number | null;
  puenktlich: number;
  gesamt: number;
}

export interface OtdPosition {
  auftrag: string;
  pos: number;
  upos: number;
  supplier_name: string | null;
  article_number: string | null;
  article_name: string | null;
  target_date: string | null;
  delivered_date: string | null;
  verzug_tage: number | null;
}

export const einkaufApi = {
  otd: async (von: string | null, bis: string | null): Promise<OtdSumme> => {
    const rows = await rpc<OtdSumme[]>("kpi_einkauf_otd", { von, bis });
    return rows[0] ?? { quote: null, puenktlich: 0, gesamt: 0, verzug_schnitt: null };
  },
  verlauf: (von: string | null, bis: string | null) =>
    rpc<OtdVerlaufPunkt[]>("kpi_einkauf_otd_verlauf", { von, bis, takt: takt(von, bis) }),
  positionen: (von: string | null, bis: string | null, grenze = 500) =>
    rpc<OtdPosition[]>("kpi_einkauf_positionen", { von, bis, grenze }),
};

/** Verzug mit Vorzeichen, eine Nachkommastelle — negativ heißt zu früh. */
export function verzugText(tage: number | null | undefined): string {
  if (tage == null) return "—";
  const gerundet = Math.round(tage * 10) / 10;
  return `${gerundet > 0 ? "+" : ""}${gerundet.toLocaleString("de-DE")} d`;
}
