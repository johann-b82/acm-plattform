/**
 * Farbrollen der Plattform und ihre Kontrastprüfung (SET-06).
 *
 * **Welche Rollen.** Keine starre Palette, sondern das, was die Oberfläche
 * tatsächlich einfärbt: Die Hauptfarbe steht in `--ring` und trägt Fokusrahmen,
 * Links, die Hauptreihe der Diagramme, Ablageflächen beim Ziehen und die Fläche
 * der Primärknöpfe. Darauf steht Schrift in `--ring-fg`. Beides je einmal für
 * hell und dunkel — ein Blau, das auf Weiß gut lesbar ist, versinkt auf dunklem
 * Grund. Flächen, Schrift und die Statusfarben gut/schlecht bleiben fest: sie
 * sind semantisch, nicht Markenfarbe.
 *
 * **Vorgabe.** Das Blau des Firmenlogos, #0041F6 — die einzige deckende Farbe
 * in `ACM_Logo_Blue_00.png` von acm-aerospace.com. Für dunkel dieselbe Tonlage
 * aufgehellt.
 *
 * **Maßstab.** WCAG 2.2 (W3C-Empfehlung vom 12.12.2024), geprüft auf w3.org:
 * 1.4.3 Kontrast (Minimum) verlangt für Text 4,5:1, 1.4.11 Nicht-Text-Kontrast
 * für Bedienelemente, Zustände und Grafiken 3:1. Relative Luminanz mit der
 * Linearisierungsschwelle 0,04045; das Verhältnis wird nicht gerundet.
 */

export interface Farbrollen {
  hauptfarbe: string;
  textAufHauptfarbe: string;
}

export interface Erscheinung {
  hell: Farbrollen;
  dunkel: Farbrollen;
}

export type Thema = keyof Erscheinung;

export const STANDARD_ERSCHEINUNG: Erscheinung = {
  hell: { hauptfarbe: "#0041F6", textAufHauptfarbe: "#FFFFFF" },
  dunkel: { hauptfarbe: "#7A9BFF", textAufHauptfarbe: "#101418" },
};

/** Die festen Flächen aus `globals.css` — gegen sie wird geprüft. */
export const FLAECHEN: Record<Thema, { bg: string; surface: string; muted: string }> = {
  hell: { bg: "#fafafa", surface: "#ffffff", muted: "#f1f3f5" },
  dunkel: { bg: "#101418", surface: "#171c21", muted: "#1f262d" },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function istHexfarbe(wert: unknown): wert is string {
  return typeof wert === "string" && HEX.test(wert);
}

function kanal(wert8: number): number {
  const c = wert8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminanz(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * kanal((n >> 16) & 255) + 0.7152 * kanal((n >> 8) & 255) + 0.0722 * kanal(n & 255);
}

export function kontrast(a: string, b: string): number {
  const la = relativeLuminanz(a);
  const lb = relativeLuminanz(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Wo eine Kombination in der Oberfläche vorkommt — Schlüssel ins Wörterbuch. */
export type Bereich = "linkSeite" | "linkKarte" | "fokusFlaeche" | "diagramm" | "knopfText";

export interface Pruefung {
  thema: Thema;
  bereich: Bereich;
  vorder: string;
  hinter: string;
  verhaeltnis: number;
  mindestens: 4.5 | 3;
  bestanden: boolean;
}

/** Die tatsächlichen Kombinationen je Thema. */
export function pruefeKontraste(e: Erscheinung): Pruefung[] {
  const ergebnis: Pruefung[] = [];
  for (const thema of ["hell", "dunkel"] as const) {
    const { hauptfarbe, textAufHauptfarbe } = e[thema];
    const f = FLAECHEN[thema];
    const faelle: [Bereich, string, string, 4.5 | 3][] = [
      // Links in Hilfe und Listen stehen auf dem Seitengrund …
      ["linkSeite", hauptfarbe, f.bg, 4.5],
      // … und auf Karten, etwa in der Tag-Auswahl.
      ["linkKarte", hauptfarbe, f.surface, 4.5],
      // Fokusrahmen und Ablageflächen liegen auch auf grauer Hervorhebung.
      ["fokusFlaeche", hauptfarbe, f.muted, 3],
      // Die Hauptreihe eines Diagramms auf der Karte.
      ["diagramm", hauptfarbe, f.surface, 3],
      // Die Beschriftung des Primärknopfs.
      ["knopfText", textAufHauptfarbe, hauptfarbe, 4.5],
    ];
    for (const [bereich, vorder, hinter, mindestens] of faelle) {
      const verhaeltnis = kontrast(vorder, hinter);
      ergebnis.push({ thema, bereich, vorder, hinter, verhaeltnis, mindestens, bestanden: verhaeltnis >= mindestens });
    }
  }
  return ergebnis;
}

/** Aus der Datenbank gelesen: was kein gültiger Hexwert ist, kommt aus der Vorgabe. */
export function erscheinungAus(roh: unknown): Erscheinung {
  const quelle = (roh && typeof roh === "object" ? roh : {}) as Record<string, Record<string, unknown> | undefined>;
  const rollen = (thema: Thema): Farbrollen => {
    const r = quelle[thema] ?? {};
    const vorgabe = STANDARD_ERSCHEINUNG[thema];
    return {
      hauptfarbe: istHexfarbe(r.hauptfarbe) ? r.hauptfarbe : vorgabe.hauptfarbe,
      textAufHauptfarbe: istHexfarbe(r.textAufHauptfarbe) ? r.textAufHauptfarbe : vorgabe.textAufHauptfarbe,
    };
  };
  return { hell: rollen("hell"), dunkel: rollen("dunkel") };
}

/**
 * Das Stylesheet für den Dokumentkopf. `html:root` statt `:root`, damit es die
 * Werte aus `globals.css` unabhängig von der Reihenfolge im Kopf überschreibt;
 * die dunklen Regeln sind dieselben drei Wege wie dort.
 */
export function cssVariablen(e: Erscheinung): string {
  const sicher = erscheinungAus(e);
  const werte = (r: Farbrollen) => `--ring:${r.hauptfarbe};--ring-fg:${r.textAufHauptfarbe};`;
  return (
    `html:root{${werte(sicher.hell)}}` +
    `@media (prefers-color-scheme: dark){html:root:not([data-theme="light"]){${werte(sicher.dunkel)}}}` +
    `html:root[data-theme="dark"]{${werte(sicher.dunkel)}}`
  );
}
