import { de } from "@/texte/de";
import { en } from "@/texte/en";
import type { Sprache } from "@/lib/sprache";

export type { Texte } from "@/texte/de";

/** Alle Wörterbücher. Eine neue Sprache ist eine Datei und ein Eintrag hier. */
export const WOERTERBUCH = { de, en };

export function texteFuer(sprache: Sprache) {
  return WOERTERBUCH[sprache];
}
