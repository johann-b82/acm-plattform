/**
 * Die Hilfe in der Anwendung.
 *
 * Die Seiten stehen als TypeScript-Module, nicht als `.md`-Dateien neben dem
 * Code. Grund ist das Abbild: Next.js baut `standalone`, und dabei landen nur
 * Dateien im Abbild, die der Build verfolgt hat. Eine Markdown-Datei, die erst
 * zur Laufzeit gelesen würde, wäre dort nicht — die Hilfe wäre in der
 * Entwicklung da und in Produktion weg. Ein Modul ist Teil des Builds.
 *
 * Die Seiten des Altprojekts sind **nicht** übernommen. Sie beschreiben dessen
 * Oberfläche: Sprachumschalter, Directus-Benutzerverwaltung, Signage in der
 * Anwendung, Organigramm. Davon gibt es hier nichts oder anderes; abgeschrieben
 * wären sie ab dem ersten Tag falsch. Der Aufbau ist derselbe geblieben —
 * Einstieg, Anwendung, Administration.
 */

export interface Seite {
  slug: string;
  titel: string;
  /** Ein Satz für die Übersicht. */
  kurz: string;
  /** Markdown. Wird mit `react-markdown` gesetzt. */
  text: string;
}

export interface Gruppe {
  id: string;
  titel: string;
  beschreibung: string;
  seiten: Seite[];
}

import { EINSTIEG } from "./einstieg";
import { KENNZAHLEN } from "./kennzahlen";
import { ARBEITEN } from "./arbeiten";
import { FACH } from "./fach";
import { VERWALTUNG } from "./verwaltung";

export const GRUPPEN: Gruppe[] = [EINSTIEG, KENNZAHLEN, ARBEITEN, FACH, VERWALTUNG];

export const ALLE: Seite[] = GRUPPEN.flatMap((g) => g.seiten);

export function finde(slug: string): { seite: Seite; gruppe: Gruppe } | null {
  for (const gruppe of GRUPPEN) {
    const seite = gruppe.seiten.find((s) => s.slug === slug);
    if (seite) return { seite, gruppe };
  }
  return null;
}

/** Volltextsuche über Titel und Text — die Hilfe ist klein genug dafür. */
export function suche(begriff: string): { seite: Seite; gruppe: Gruppe }[] {
  const gesucht = begriff.trim().toLowerCase();
  if (gesucht.length < 2) return [];
  const treffer: { seite: Seite; gruppe: Gruppe }[] = [];
  for (const gruppe of GRUPPEN) {
    for (const seite of gruppe.seiten) {
      const heuhaufen = `${seite.titel} ${seite.kurz} ${seite.text}`.toLowerCase();
      if (heuhaufen.includes(gesucht)) treffer.push({ seite, gruppe });
    }
  }
  return treffer;
}
