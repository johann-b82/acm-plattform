import { supabaseBrowser } from "@/lib/supabase/client";

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

export type Zeitraum = "monat" | "quartal" | "jahr" | "alles";

export const ZEITRAUM_LABEL: Record<Zeitraum, string> = {
  monat: "Dieser Monat",
  quartal: "Dieses Quartal",
  jahr: "Dieses Jahr",
  alles: "Alles",
};

/** Lokales Datum als `YYYY-MM-DD`.
 *
 *  Bewusst nicht `toISOString()`: das rechnet nach UTC um, und der 1. Januar
 *  00:00 in Mitteleuropa wird dabei zum 31. Dezember. Das Fenster hätte dann
 *  einen Tag aus dem Vorzeitraum enthalten. */
function iso(d: Date): string {
  const monat = String(d.getMonth() + 1).padStart(2, "0");
  const tag = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${monat}-${tag}`;
}

/** Zeitraum in ein Datumsfenster übersetzen; `alles` lässt beide Grenzen offen. */
export function fenster(zeitraum: Zeitraum, heute = new Date()): { von: string | null; bis: string | null } {
  if (zeitraum === "alles") return { von: null, bis: null };
  const bis = iso(heute);
  if (zeitraum === "monat") {
    return { von: iso(new Date(heute.getFullYear(), heute.getMonth(), 1)), bis };
  }
  if (zeitraum === "quartal") {
    const q = Math.floor(heute.getMonth() / 3) * 3;
    return { von: iso(new Date(heute.getFullYear(), q, 1)), bis };
  }
  return { von: iso(new Date(heute.getFullYear(), 0, 1)), bis };
}

/** Bucket-Breite nach Fensterlänge, wie im Altprojekt (`_bucket_windows`). */
export function takt(von: string | null, bis: string | null): "day" | "week" | "month" {
  if (!von || !bis) return "month";
  const tage = (new Date(bis).getTime() - new Date(von).getTime()) / 86_400_000;
  if (tage <= 31) return "day";
  if (tage <= 91) return "week";
  return "month";
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
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

const EUR = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const EUR_GENAU = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const PROZENT = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
const ZAHL = new Intl.NumberFormat("de-DE");

export const fmt = {
  eur: (v: number | null | undefined) => (v == null ? "—" : EUR.format(v)),
  eurGenau: (v: number | null | undefined) => (v == null ? "—" : EUR_GENAU.format(v)),
  prozent: (v: number | null | undefined) => (v == null ? "—" : PROZENT.format(v)),
  zahl: (v: number | null | undefined) => (v == null ? "—" : ZAHL.format(v)),
};

/** Bucket-Beschriftung für die Achse, abhängig vom Takt. */
export function bucketLabel(iso: string, t: "day" | "week" | "month"): string {
  const d = new Date(iso);
  if (t === "month") return d.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
