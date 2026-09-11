import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Was sich alle Kennzahlen-Seiten teilen: Zeitraumwahl, Bucket-Breite,
 * Formatierung und der Aufruf einer SQL-Funktion über PostgREST.
 *
 * Die Rechenwege selbst liegen je Modul in der Datenbank. Hier steht nur die
 * Mechanik, die im Altprojekt in `_bucket_windows` und den Formatierern des
 * Frontends lag — einmal, nicht je Dashboard.
 */

export type Zeitraum = "monat" | "quartal" | "jahr" | "alles" | "frei";

export const ZEITRAUM_LABEL: Record<Zeitraum, string> = {
  monat: "Dieser Monat",
  quartal: "Dieses Quartal",
  jahr: "Dieses Jahr",
  alles: "Alles",
  frei: "Zeitraum wählen",
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

/**
 * Zeitraum in ein Datumsfenster übersetzen; `alles` lässt beide Grenzen offen.
 *
 * `frei` steht hier nicht: dessen Grenzen kommen von der Eingabe und nicht aus
 * einer Rechnung. Die Wahl hält `useZeitraumwahl` zusammen.
 */
export function fenster(zeitraum: Zeitraum, heute = new Date()): { von: string | null; bis: string | null } {
  if (zeitraum === "alles" || zeitraum === "frei") return { von: null, bis: null };
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

export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

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
