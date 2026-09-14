/**
 * Rückwege in der rechten Leiste sind Knöpfe, keine unterstrichenen
 * Textverweise: in einem Navigationsabschnitt steht ein einzelner Verweis
 * als `ButtonLink`. Listen von Verweisen (Reiter, Sprungmarken) sind davon
 * ausgenommen — sie laufen über `.map(`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WURZEL = join(__dirname, "..", "..");

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return name === "__tests__" ? [] : dateien(pfad);
    return pfad.endsWith(".tsx") && !pfad.endsWith(".test.tsx") ? [pfad] : [];
  });
}

describe("Rechte Leiste", () => {
  it("führt Rückwege als Knöpfe, nicht als Textverweise", () => {
    const funde: string[] = [];
    for (const datei of [...dateien(join(WURZEL, "app")), ...dateien(join(WURZEL, "components"))]) {
      const text = readFileSync(datei, "utf8");
      for (const block of text.matchAll(/<Seitenwerkzeuge kategorie="navigation">([\s\S]*?)<\/Seitenwerkzeuge>/g)) {
        if (block[1].includes(".map(")) continue;
        if (/<Link\b/.test(block[1]) || /hover:underline/.test(block[1])) funde.push(datei.slice(WURZEL.length));
      }
    }
    expect(funde).toEqual([]);
  });
});
