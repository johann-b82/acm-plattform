/**
 * Die Kontrastprüfung der Farbrollen (SET-06).
 *
 * Maßstab ist WCAG 2.2 (W3C-Empfehlung vom 12.12.2024): 1.4.3 verlangt für
 * Text 4,5:1, 1.4.11 für Bedienelemente und Grafiken 3:1. Verglichen wird
 * ungerundet — 4,499:1 besteht 4,5:1 nicht.
 */
import { describe, expect, it } from "vitest";

import {
  STANDARD_ERSCHEINUNG,
  cssVariablen,
  erscheinungAus,
  istHexfarbe,
  kontrast,
  pruefeKontraste,
  relativeLuminanz,
} from "@/lib/kontrast";

describe("relative Luminanz und Kontrastverhältnis", () => {
  it("Schwarz und Weiß sind die Enden der Skala", () => {
    expect(relativeLuminanz("#000000")).toBe(0);
    expect(relativeLuminanz("#FFFFFF")).toBeCloseTo(1, 10);
    expect(kontrast("#000000", "#ffffff")).toBeCloseTo(21, 10);
  });

  it("die Reihenfolge der Farben spielt keine Rolle", () => {
    expect(kontrast("#0041F6", "#ffffff")).toBe(kontrast("#ffffff", "#0041F6"));
  });

  it("nutzt die Schwelle 0,04045 der Linearisierung", () => {
    // 10/255 = 0,0392 liegt unter beiden Schwellen, 11/255 = 0,0431 darüber.
    expect(relativeLuminanz("#0a0a0a")).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(relativeLuminanz("#0b0b0b")).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 12);
  });

  it("das Logoblau auf Weiß hat 6,80:1", () => {
    expect(kontrast("#0041F6", "#ffffff")).toBeCloseTo(6.803, 3);
  });
});

describe("istHexfarbe", () => {
  it("nimmt nur sechsstellige Hexwerte", () => {
    expect(istHexfarbe("#0041F6")).toBe(true);
    expect(istHexfarbe("#0041f6")).toBe(true);
    expect(istHexfarbe("#04f")).toBe(false);
    expect(istHexfarbe("red")).toBe(false);
    expect(istHexfarbe("#0041F6;} body{display:none")).toBe(false);
  });
});

describe("pruefeKontraste", () => {
  it("die Vorgabe besteht in hell und dunkel jede Prüfung", () => {
    const ergebnis = pruefeKontraste(STANDARD_ERSCHEINUNG);
    expect(ergebnis.length).toBeGreaterThan(0);
    expect(ergebnis.filter((p) => !p.bestanden)).toEqual([]);
    expect(new Set(ergebnis.map((p) => p.thema))).toEqual(new Set(["hell", "dunkel"]));
  });

  it("die Vorgabe ist das echte Logoblau, nicht Petrol", () => {
    expect(STANDARD_ERSCHEINUNG.hell.hauptfarbe.toUpperCase()).toBe("#0041F6");
    expect(STANDARD_ERSCHEINUNG.hell.hauptfarbe.toUpperCase()).not.toBe("#005B85");
  });

  it("meldet ungeeignete Testfarben mit Bereich, Thema und Mindestwert", () => {
    const schlecht = {
      ...STANDARD_ERSCHEINUNG,
      // Hellgelb auf Weiß, und Weiß darauf als Knopftext.
      hell: { hauptfarbe: "#FFEB3B", textAufHauptfarbe: "#FFFFFF" },
    };
    const fehler = pruefeKontraste(schlecht).filter((p) => !p.bestanden);
    expect(fehler.every((p) => p.thema === "hell")).toBe(true);
    const bereiche = fehler.map((p) => p.bereich);
    expect(bereiche).toContain("linkSeite");
    expect(bereiche).toContain("knopfText");
    const knopf = fehler.find((p) => p.bereich === "knopfText")!;
    expect(knopf.mindestens).toBe(4.5);
    expect(knopf.verhaeltnis).toBeLessThan(4.5);
  });

  it("Text braucht 4,5:1, Bedienelemente und Grafiken 3:1", () => {
    const art = new Map(pruefeKontraste(STANDARD_ERSCHEINUNG).map((p) => [p.bereich, p.mindestens]));
    expect(art.get("linkSeite")).toBe(4.5);
    expect(art.get("knopfText")).toBe(4.5);
    expect(art.get("fokusFlaeche")).toBe(3);
    expect(art.get("diagramm")).toBe(3);
  });

  it("rundet nicht: knapp unter der Grenze fällt durch", () => {
    // #767676 auf Weiß ist 4,54:1, #777777 ist 4,48:1.
    const knapp = {
      ...STANDARD_ERSCHEINUNG,
      hell: { hauptfarbe: "#0041F6", textAufHauptfarbe: "#FFFFFF" },
    };
    expect(kontrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(kontrast("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(pruefeKontraste(knapp).every((p) => p.bestanden)).toBe(true);
  });
});

describe("erscheinungAus", () => {
  it("nimmt fehlende oder kaputte Werte aus der Vorgabe", () => {
    expect(erscheinungAus(null)).toEqual(STANDARD_ERSCHEINUNG);
    expect(
      erscheinungAus({ hell: { hauptfarbe: "url(javascript:x)", textAufHauptfarbe: "#000000" } }),
    ).toEqual({
      ...STANDARD_ERSCHEINUNG,
      hell: { ...STANDARD_ERSCHEINUNG.hell, textAufHauptfarbe: "#000000" },
    });
  });
});

describe("cssVariablen", () => {
  it("setzt hell, dunkel nach System und dunkel nach Wahl", () => {
    const css = cssVariablen(STANDARD_ERSCHEINUNG);
    expect(css).toContain("--ring:#0041F6");
    expect(css).toContain("--ring-fg:#FFFFFF");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(STANDARD_ERSCHEINUNG.dunkel.hauptfarbe);
  });

  it("lässt keine fremden Zeichen in das Stylesheet", () => {
    const css = cssVariablen(
      erscheinungAus({ hell: { hauptfarbe: "#000;}</style><script>", textAufHauptfarbe: "#fff" } }),
    );
    expect(css).not.toContain("<");
    expect(css).not.toContain("script");
  });
});
