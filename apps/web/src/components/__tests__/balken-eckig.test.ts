/**
 * Balkendiagramme haben spitze Ecken: kein `radius` an einem Recharts-Balken,
 * und kein `rounded` an Balken, deren Länge über `style={{ width }}` kommt.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WURZEL = join(import.meta.dirname, "..", "..");

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return name === "__tests__" ? [] : dateien(pfad);
    return pfad.endsWith(".tsx") && !pfad.endsWith(".test.tsx") ? [pfad] : [];
  });
}

const alle = () => [...dateien(join(WURZEL, "app")), ...dateien(join(WURZEL, "components"))];

describe("Balkendiagramme", () => {
  it("runden keine Recharts-Balken", () => {
    const funde = alle().flatMap((datei) =>
      readFileSync(datei, "utf8")
        .split("\n")
        .flatMap((zeile, i) => (/\bradius=/.test(zeile) ? [`${datei.slice(WURZEL.length)}:${i + 1}`] : [])),
    );
    expect(funde).toEqual([]);
  });

  it("runden keine Balken, deren Länge über die Breite kommt", () => {
    const funde = alle().flatMap((datei) => {
      const zeilen = readFileSync(datei, "utf8").split("\n");
      return zeilen.flatMap((zeile, i) => {
        if (!/width: `/.test(zeile)) return [];
        // Der Balken und seine Spur stehen in den Zeilen direkt davor.
        const umfeld = zeilen.slice(Math.max(0, i - 4), i).join("\n");
        return /\brounded(-full)?\b/.test(umfeld) ? [`${datei.slice(WURZEL.length)}:${i + 1}`] : [];
      });
    });
    expect(funde).toEqual([]);
  });
});
