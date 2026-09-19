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

/** Die Breite eines Buckets im Verlauf. */
export type Takt = "day" | "week" | "month";

/** Bucket-Breite nach Fensterlänge, wie im Altprojekt (`_bucket_windows`). */
/**
 * Fehlende Buckets mit Null-Zeilen auffüllen, damit ein Verlauf keine Löcher
 * hat (VER-04B). Die Datenbank liefert nur Buckets mit Daten; über einen
 * langen Zeitraum (etwa „Alles") fehlen dazwischen ganze Monate, und die
 * Fläche zerfiele in Inseln. Aufgefüllt wird von der ersten bis zur letzten
 * vorhandenen Zeile in Schritten des Takts — führende und nachlaufende Leere
 * bleibt weg, gemeint sind nur die Lücken zwischen Werten.
 *
 * `leer` baut die Null-Zeile zu einem Bucket; die Aufrufstelle weiß, welche
 * Reihen bei null stehen. Bei Kennzahlen wie Temperatur, wo eine fehlende
 * Messung keine Null ist, wird bewusst nicht aufgefüllt.
 */
export function dichteBuckets<T extends { bucket: string }>(
  reihen: readonly T[],
  t: Takt,
  leer: (bucket: string) => T,
): T[] {
  if (reihen.length < 2) return [...reihen];
  const sortiert = [...reihen].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const vorhanden = new Map(sortiert.map((z) => [z.bucket, z]));
  const naechster = (iso: string): string => {
    const [j, m, tag] = iso.split("-").map(Number);
    const d = new Date(Date.UTC(j, m - 1, tag));
    if (t === "day") d.setUTCDate(d.getUTCDate() + 1);
    else if (t === "week") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  };
  const ende = sortiert[sortiert.length - 1].bucket;
  const dicht: T[] = [];
  // Wächter gegen einen krummen Bucket, der nie genau auf `ende` trifft.
  for (let b = sortiert[0].bucket, i = 0; b <= ende && i < 100_000; b = naechster(b), i++) {
    dicht.push(vorhanden.get(b) ?? leer(b));
  }
  return dicht;
}

export function takt(von: string | null, bis: string | null): Takt {
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

/**
 * Wie `rpc`, für Listen, die eine Tabelle vollständig braucht (TAB-01): Seite
 * um Seite über `range`, bis eine Seite nicht mehr voll ist. So schneidet das
 * Zeilenmaximum von PostgREST (bei Supabase üblich 1000) nichts still ab.
 *
 * Die SQL-Funktion muss eindeutig sortieren — sonst verrutschen Zeilen
 * zwischen zwei Seiten.
 */
export async function rpcAlle<T>(name: string, args: Record<string, unknown>, seite = 1000): Promise<T[]> {
  const alle: T[] = [];
  for (let start = 0; ; start += seite) {
    const { data, error } = await supabaseBrowser()
      .rpc(name, args)
      .range(start, start + seite - 1);
    if (error) throw new Error(error.message);
    const teil = (data ?? []) as T[];
    alle.push(...teil);
    if (teil.length < seite) return alle;
  }
}

/**
 * Zahlen und Beträge in einer Sprache.
 *
 * Die Währung bleibt der Euro — er ist keine Frage der Anzeigesprache,
 * sondern die Währung, in der die Zahlen vorliegen. Trennzeichen und
 * Stellung des Zeichens folgen der Sprache: „1.234 €" liest sich für jemanden
 * mit englischer Oberfläche als eintausendzweihundertvierunddreißig
 * Tausendstel.
 *
 * Je Sprache einmal gebaut und gemerkt: `Intl.NumberFormat` ist nicht billig,
 * und ein Dashboard ruft es tausendfach.
 */
const GEMERKT = new Map<string, Formate>();

export interface Formate {
  eur: (v: number | null | undefined) => string;
  eurGenau: (v: number | null | undefined) => string;
  prozent: (v: number | null | undefined) => string;
  zahl: (v: number | null | undefined) => string;
  /** Bucket-Beschriftung für die Achse, abhängig vom Takt. */
  bucket: (iso: string, t: "day" | "week" | "month") => string;
}

export function formate(tag: string): Formate {
  const schon = GEMERKT.get(tag);
  if (schon) return schon;
  const EUR = new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const EUR_GENAU = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" });
  const PROZENT = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 1 });
  const ZAHL = new Intl.NumberFormat(tag);
  const gebaut: Formate = {
    eur: (v) => (v == null ? "—" : EUR.format(v)),
    eurGenau: (v) => (v == null ? "—" : EUR_GENAU.format(v)),
    prozent: (v) => (v == null ? "—" : PROZENT.format(v)),
    zahl: (v) => (v == null ? "—" : ZAHL.format(v)),
    bucket: (iso, t) => {
      const d = new Date(iso);
      return t === "month"
        ? d.toLocaleDateString(tag, { month: "short", year: "2-digit" })
        : d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit" });
    },
  };
  GEMERKT.set(tag, gebaut);
  return gebaut;
}

/** Deutsch — für alles, was noch nicht übersetzt ist. */
export const fmt = formate("de-DE");

/** Bucket-Beschriftung für die Achse, abhängig vom Takt. */
export function bucketLabel(iso: string, t: "day" | "week" | "month"): string {
  return fmt.bucket(iso, t);
}
