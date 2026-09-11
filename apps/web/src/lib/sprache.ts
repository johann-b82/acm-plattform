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

export const SPRACHEN = ["de", "en"] as const;
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
};

/** Das Kürzel fürs `lang`-Attribut und für `Intl`. */
export const SPRACHE_TAG: Record<Sprache, string> = {
  de: "de-DE",
  en: "en-GB",
};

/** Prüft einen Cookie-Wert. Alles Unbekannte fällt auf Deutsch zurück. */
export function spracheAus(wert: string | undefined | null): Sprache {
  return (SPRACHEN as readonly string[]).includes(wert ?? "") ? (wert as Sprache) : VORGABE;
}
