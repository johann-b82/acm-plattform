/**
 * Welche Sprache die Oberfläche spricht.
 *
 * Anders als das Erscheinungsbild steht die Wahl in einem **Cookie** und nicht
 * im `localStorage`: die Seiten werden auf dem Server gesetzt, und der Server
 * sieht nur Cookies. Ein `localStorage`-Wert käme erst nach dem ersten Bild an
 * — die Seite käme deutsch und schaltete sichtbar um.
 *
 * Die Wahl gehört zum Gerät, nicht zum Konto — wie beim Erscheinungsbild. Ein
 * Konto am gemeinsamen Rechner in der Fertigung hätte sonst für alle dieselbe
 * Sprache.
 */

/**
 * Die angebotenen Sprachen.
 *
 * Deutsch und Englisch sind die Sprachen des Hauses. Die sechs anderen stehen
 * hier, weil die Belegschaft sie spricht: die Nationalitäten in Personio
 * zeigen nach Deutschland, Syrien, Iran, Afghanistan, Bulgarien, der Ukraine,
 * Polen, Indien und Vietnam. Ein Sprachfeld führt Personio nicht, die
 * Muttersprache ist also nicht abgefragt, sondern aus der Nationalität
 * geschlossen — Indien und die westafrikanischen Länder deckt Englisch ab.
 */
export const SPRACHEN = ["de", "en", "ar", "fa", "uk", "bg", "pl", "vi"] as const;
export type Sprache = (typeof SPRACHEN)[number];

export const VORGABE: Sprache = "de";

/** Name des Cookies. Kein `__Host-`-Präfix: es ist keine Sicherheitsangabe. */
export const COOKIE = "sprache";

/** Ein Jahr — die Wahl trifft man einmal. */
export const COOKIE_MAXALTER = 60 * 60 * 24 * 365;

/** Wie eine Sprache in ihrer eigenen Sprache heißt. */
export const SPRACHE_LABEL: Record<Sprache, string> = {
  de: "Deutsch",
  en: "English",
  ar: "العربية",
  fa: "فارسی",
  uk: "Українська",
  bg: "Български",
  pl: "Polski",
  vi: "Tiếng Việt",
};

/** Das Kürzel fürs `lang`-Attribut und für `Intl`. */
export const SPRACHE_TAG: Record<Sprache, string> = {
  de: "de-DE",
  en: "en-GB",
  ar: "ar",
  fa: "fa",
  uk: "uk",
  bg: "bg",
  pl: "pl",
  vi: "vi",
};

/**
 * Das Kürzel, mit dem `Intl` rechnet.
 *
 * Meist dasselbe wie `SPRACHE_TAG`, aber nicht immer: Arabisch und Persisch
 * setzen von Haus aus ihre eigenen Ziffern (٣٫٢ statt 3,2). Auf einer
 * Kennzahlentafel, die neben deutschen und englischen Tafeln hängt und deren
 * Zahlen jemand mit einer Excel-Spalte vergleicht, ist das ein Rückschritt —
 * `-u-nu-latn` bestellt die gewohnten Ziffern. Die Sprache der Wörter bleibt
 * davon unberührt.
 */
export const ZAHL_TAG: Record<Sprache, string> = {
  de: "de-DE",
  en: "en-GB",
  ar: "ar-u-nu-latn",
  fa: "fa-u-nu-latn",
  uk: "uk-UA",
  bg: "bg-BG",
  pl: "pl-PL",
  vi: "vi-VN",
};

/**
 * In welcher Richtung die Sprache geschrieben wird.
 *
 * Arabisch und Persisch laufen von rechts nach links. Das steht am `<html>`
 * als `dir`, und die Oberfläche ist mit logischen Kanten gesetzt — `ms-`
 * statt `ml-`, `text-end` statt `text-right` —, damit sie mitläuft, statt
 * seitenverkehrt stehenzubleiben. Physisch bleibt nur, was ein
 * Koordinatensystem ist: die Zeichnung im FAIR-Editor etwa.
 */
export const SCHREIBRICHTUNG: Record<Sprache, "ltr" | "rtl"> = {
  de: "ltr",
  en: "ltr",
  ar: "rtl",
  fa: "rtl",
  uk: "ltr",
  bg: "ltr",
  pl: "ltr",
  vi: "ltr",
};

/** Prüft einen Cookie-Wert. Alles Unbekannte fällt auf Deutsch zurück. */
export function spracheAus(wert: string | undefined | null): Sprache {
  return (SPRACHEN as readonly string[]).includes(wert ?? "") ? (wert as Sprache) : VORGABE;
}
