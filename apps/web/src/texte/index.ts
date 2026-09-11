import { ar } from "@/texte/ar";
import { bg } from "@/texte/bg";
import { de } from "@/texte/de";
import { en } from "@/texte/en";
import { fa } from "@/texte/fa";
import { pl } from "@/texte/pl";
import { uk } from "@/texte/uk";
import { vi } from "@/texte/vi";
import type { Sprache } from "@/lib/sprache";

export type { Texte } from "@/texte/de";

/** Alle Wörterbücher. Eine neue Sprache ist eine Datei und ein Eintrag hier. */
export const WOERTERBUCH = { de, en, ar, fa, uk, bg, pl, vi };

export function texteFuer(sprache: Sprache) {
  return WOERTERBUCH[sprache];
}
