import { rpc, takt } from "@/lib/kpi/gemeinsam";

/**
 * Kennzahlen des Vertriebs. Die Rechenwege stehen als SQL-Funktionen in der
 * Datenbank (Alembic 0002); hier wird nur aufgerufen. Im Altprojekt lag
 * dieselbe Rechnung in Python und lief bei Verlaufskurven einmal je
 * Zeitfenster — als `GROUP BY` ist es eine Abfrage.
 */

export interface VertriebSumme {
  umsatz: number;
  umsatz_zeilen: number;
  auftragswert_avg: number;
  auftraege_anzahl: number;
}

export interface VerlaufPunkt {
  bucket: string;
  umsatz: number;
}

export interface KundenAnteil {
  kunde: string;
  wert: number;
  anteil: number;
}

export interface ErfasserZeile {
  erfasser: string;
  auftraege_anzahl: number;
  wert_summe: number;
}

export const vertriebApi = {
  summe: async (von: string | null, bis: string | null): Promise<VertriebSumme> => {
    const rows = await rpc<VertriebSumme[]>("kpi_vertrieb_summe", { von, bis });
    return (
      rows[0] ?? { umsatz: 0, umsatz_zeilen: 0, auftragswert_avg: 0, auftraege_anzahl: 0 }
    );
  },
  verlauf: (von: string | null, bis: string | null) =>
    rpc<VerlaufPunkt[]>("kpi_vertrieb_verlauf", { von, bis, takt: takt(von, bis) }),
  kundenanteil: (quelle: "revenues" | "auftraege", von: string | null, bis: string | null, top_n = 10) =>
    rpc<KundenAnteil[]>("kpi_vertrieb_kundenanteil", { quelle, von, bis, top_n }),
  jeErfasser: (von: string | null, bis: string | null) =>
    rpc<ErfasserZeile[]>("kpi_vertrieb_je_erfasser", { von, bis }),
};
