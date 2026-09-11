import { KENNZAHLEN } from "@/hilfe/kennzahlen";

/**
 * Der Rechenweg hinter einer Kachel — ausgeschnitten aus der Hilfe.
 *
 * Das Altsystem hielt denselben Text zweimal: einmal als Kurzfassung für den
 * i-Knopf, einmal ausführlich in einer Markdown-Datei. Zwei Texte über
 * dieselbe Rechnung laufen auseinander, und dann steht an der Kachel etwas
 * anderes als in der Hilfe.
 *
 * Hier gibt es nur die Hilfe. Der Knopf zeigt den Abschnitt, der zur Kachel
 * gehört, und verweist auf die ganze Seite.
 */

export interface Erklaerung {
  /** Slug einer Hilfeseite aus der Gruppe „Kennzahlen“. */
  seite: string;
  /** Überschrift zweiter Ordnung auf dieser Seite, ohne die Rauten. */
  abschnitt: string;
}

/**
 * Schneidet `## Überschrift` bis zur nächsten Überschrift gleicher Ordnung
 * heraus, die Überschrift selbst eingeschlossen. `null`, wenn es sie nicht
 * gibt — der Knopf bleibt dann weg, statt ein leeres Fenster aufzumachen.
 */
export function abschnittAus(
  text: string,
  ueberschrift: string,
): string | null {
  const zeilen = text.split("\n");
  const anfang = zeilen.findIndex((z) => z.trim() === `## ${ueberschrift}`);
  if (anfang === -1) return null;
  let ende = zeilen.length;
  for (let i = anfang + 1; i < zeilen.length; i += 1) {
    // `# ` beendet auch: eine Überschrift erster Ordnung ist ein neues Kapitel.
    if (/^#{1,2} /.test(zeilen[i])) {
      ende = i;
      break;
    }
  }
  return zeilen.slice(anfang, ende).join("\n").trim();
}

/** Text und Ziel für eine Kachel. `null`, wenn die Hilfe das nicht hergibt. */
export function erklaerungText(erklaerung: Erklaerung): string | null {
  const seite = KENNZAHLEN.seiten.find((s) => s.slug === erklaerung.seite);
  if (!seite) return null;
  return abschnittAus(seite.text, erklaerung.abschnitt);
}
