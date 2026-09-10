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

/** Eine Zeile je ISO-Woche und Vertriebler. Die Karte summiert über die
 *  Vertriebler für den Balken und zeigt die Aufteilung im Tooltip. */
export interface AktivitaetZeile {
  iso_jahr: number;
  iso_woche: number;
  erfasser: string;
  erstkontakte: number;
  besuche_ort: number;
  besuche_onl: number;
  angebote_eur: number;
  auftraege_eur: number;
}

/** Interessenten haben keine Vertriebler-Spalte — die Quelldatei kennt keine. */
export interface InteressentenZeile {
  iso_jahr: number;
  iso_woche: number;
  anzahl: number;
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
  aktivitaet: (von: string, bis: string) =>
    rpc<AktivitaetZeile[]>("kpi_vertrieb_aktivitaet", { p_von: von, p_bis: bis }),
  interessenten: (von: string, bis: string) =>
    rpc<InteressentenZeile[]>("kpi_vertrieb_interessenten", { p_von: von, p_bis: bis }),
};

/** Fenster für die Wochenkarte.
 *
 *  Die Karte hängt nicht am Zeitraumwähler des Dashboards: sie zeigt Wochen,
 *  und „Dieser Monat" ergäbe vier Balken. Ist ein Zeitraum gewählt, wird er
 *  benutzt; bei „Alles" die letzten zwölf ISO-Wochen bis zum Sonntag der
 *  laufenden Woche.
 *
 *  Im Altprojekt blieb die Karte bei „Alles" leer — eine Notlösung für eine
 *  unbegrenzte Abfrage, die es hier nicht braucht.
 */
export function wochenfenster(
  von: string | null,
  bis: string | null,
  heute = new Date(),
): { von: string; bis: string } {
  if (von && bis) return { von, bis };
  const sonntag = new Date(heute);
  // getDay(): 0 = Sonntag. Der Sonntag der laufenden ISO-Woche liegt
  // (7 − Wochentag) Tage voraus, für den Sonntag selbst null Tage.
  sonntag.setDate(sonntag.getDate() + ((7 - sonntag.getDay()) % 7));
  const montag = new Date(sonntag);
  montag.setDate(montag.getDate() - (12 * 7 - 1));
  return { von: alsIso(montag), bis: alsIso(sonntag) };
}

function alsIso(d: Date): string {
  const monat = String(d.getMonth() + 1).padStart(2, "0");
  const tag = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${monat}-${tag}`;
}
