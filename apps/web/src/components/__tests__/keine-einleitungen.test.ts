/**
 * Über den Seiten stehen keine erklärenden Einleitungssätze mehr (Nutzerwunsch):
 * kein `Seitenkopf`/`Kacheln` bekommt einen `…einleitung`-Text als Untertitel.
 * Ein Wächter über den Quelltext, weil die meisten Seiten keinen eigenen
 * Komponententest haben.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WURZEL = path.resolve(__dirname, "../..");

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const voll = path.join(ordner, name);
    if (statSync(voll).isDirectory()) return name === "__tests__" ? [] : dateien(voll);
    return name.endsWith(".tsx") ? [voll] : [];
  });
}

describe("Einleitungssätze", () => {
  it("setzt keinen Einleitungstext als Untertitel", () => {
    const funde = [path.join(WURZEL, "app"), path.join(WURZEL, "components")]
      .flatMap(dateien)
      .flatMap((datei) =>
        readFileSync(datei, "utf8")
          .split("\n")
          .map((zeile, i) => ({ datei: path.relative(WURZEL, datei), zeile: i + 1, text: zeile.trim() }))
          .filter(({ text }) => /untertitel=\{[^}]*[eE]inleitung\b/.test(text)),
      );
    expect(funde).toEqual([]);
  });
});
