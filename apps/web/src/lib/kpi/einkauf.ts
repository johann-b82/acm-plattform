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

// ---------------------------------------------------------------------------
// Bestellung auf Lager: Ladenhüter
// ---------------------------------------------------------------------------

export interface LadenhueterZeile {
  artnr: string;
  article_name: string | null;
  bestand: number;
  letzte_bewegung: string;
  tage_liegend: number;
  stueckpreis: number;
  wert: number;
}

/**
 * Wie lange ein Artikel unbewegt sein muss, um als Ladenhüter zu gelten.
 * Im Altprojekt sendet das Frontend diesen Wert nie und rechnet immer mit 28
 * Tagen; das bleibt so, bis jemand danach fragt.
 */
export const LIEGETAGE = 28;

export const ladenhueterApi = {
  top: async (grenze = 20): Promise<LadenhueterZeile[]> => {
    const rows = await rpc<LadenhueterZeile[]>("kpi_einkauf_ladenhueter", {
      tage_ohne_bewegung: LIEGETAGE,
      grenze,
    });
    return rows.map((z) => ({
      ...z,
      bestand: Number(z.bestand),
      stueckpreis: Number(z.stueckpreis),
      wert: Number(z.wert),
    }));
  },
};

/** Gebundenes Kapital: Summe der angezeigten Zeilen, nicht des ganzen Lagers. */
export function gebundenesKapital(zeilen: readonly LadenhueterZeile[]): number {
  return zeilen.reduce((summe, z) => summe + z.wert, 0);
}
