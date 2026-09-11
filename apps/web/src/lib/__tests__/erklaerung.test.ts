import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { abschnittAus, erklaerungText } from "@/lib/erklaerung";

const TEXT = `
# Einkauf

Vorspann.

## Liefertermintreue

Anteil pünktlicher Positionen.

* eine Liste
* noch eine

## Ladenhüter

Was lange liegt.

# Anderes Kapitel

Gehört nicht mehr dazu.
`.trim();

describe("abschnittAus", () => {
  it("schneidet bis zur nächsten Überschrift gleicher Ordnung", () => {
    const a = abschnittAus(TEXT, "Liefertermintreue");
    expect(a).toContain("## Liefertermintreue");
    expect(a).toContain("noch eine");
    expect(a).not.toContain("Ladenhüter");
  });

  it("nimmt die Überschrift mit — sie sagt, worüber man gerade liest", () => {
    expect(abschnittAus(TEXT, "Ladenhüter")?.startsWith("## Ladenhüter")).toBe(true);
  });

  it("endet auch an einer Überschrift erster Ordnung", () => {
    expect(abschnittAus(TEXT, "Ladenhüter")).not.toContain("Anderes Kapitel");
  });

  it("nimmt den Vorspann nicht mit", () => {
    expect(abschnittAus(TEXT, "Liefertermintreue")).not.toContain("Vorspann");
  });

  it("gibt null zurück, wenn es den Abschnitt nicht gibt", () => {
    // Der Knopf bleibt dann weg, statt ein leeres Fenster aufzumachen.
    expect(abschnittAus(TEXT, "Gibt es nicht")).toBeNull();
  });

  it("verwechselt eine Überschrift dritter Ordnung nicht mit einer zweiten", () => {
    expect(abschnittAus("## A\ntext\n### A-Detail\nmehr\n## B\nx", "A")).toBe(
      "## A\ntext\n### A-Detail\nmehr",
    );
  });
});

describe("erklaerungText", () => {
  it("findet einen echten Abschnitt aus der Hilfe", () => {
    expect(erklaerungText({ seite: "einkauf", abschnitt: "Liefertermintreue" })).toContain(
      "Positionsebene",
    );
  });

  it("gibt null für eine Seite zurück, die es nicht gibt", () => {
    expect(erklaerungText({ seite: "gibtesnicht", abschnitt: "Egal" })).toBeNull();
  });
});

/**
 * Jede Kachel verweist auf einen Abschnitt der Hilfe. Ändert sich dort eine
 * Überschrift, verschwindet das „i“ — lautlos, weil kein Text kein Knopf ist.
 * Deshalb dieser Test: er liest die Dashboards und prüft jeden Verweis.
 */
describe("Verweise der Kacheln", () => {
  const wurzel = path.resolve(__dirname, "../../app/(app)");

  function dateien(ordner: string): string[] {
    const gefunden: string[] = [];
    for (const e of readdirSync(ordner, { withFileTypes: true })) {
      const voll = path.join(ordner, e.name);
      if (e.isDirectory()) gefunden.push(...dateien(voll));
      else if (e.name.endsWith("-dashboard.tsx")) gefunden.push(voll);
    }
    return gefunden;
  }

  const verweise = dateien(wurzel).flatMap((datei) =>
    [
      ...readFileSync(datei, "utf8").matchAll(
        /erklaerung=\{\{\s*seite:\s*"([^"]+)",\s*abschnitt:\s*"([^"]+)"\s*,?\s*\}\}/g,
      ),
    ].map((m) => ({ datei: path.basename(datei), seite: m[1], abschnitt: m[2] })),
  );

  it("findet die Verweise überhaupt", () => {
    expect(verweise.length).toBeGreaterThanOrEqual(28);
  });

  it.each(verweise)("$datei: $seite → $abschnitt", ({ seite, abschnitt }) => {
    expect(erklaerungText({ seite, abschnitt })).toBeTruthy();
  });
});
