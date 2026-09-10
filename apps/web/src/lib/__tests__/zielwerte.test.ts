import { describe, expect, it } from "vitest";

import { alsAnzeige, ausAnzeige, nachSchluessel, verfehlt } from "../zielwerte";

describe("Umrechnung", () => {
  it("zeigt Anteile als Prozent", () => {
    expect(alsAnzeige(0.98, "anteil")).toBe(98);
    expect(alsAnzeige(0.105, "anteil")).toBe(10.5);
  });

  it("lässt Anzahlen unverändert", () => {
    expect(alsAnzeige(5, "anzahl")).toBe(5);
  });

  it("rundet auf eine Nachkommastelle", () => {
    // Sonst stünde 12.339999999999998 im Eingabefeld.
    expect(alsAnzeige(0.1234, "anteil")).toBe(12.3);
  });

  it("rechnet zurück", () => {
    expect(ausAnzeige(98, "anteil")).toBe(0.98);
    expect(ausAnzeige(5, "anzahl")).toBe(5);
  });
});

describe("verfehlt", () => {
  it("min: weniger als das Ziel ist schlecht", () => {
    expect(verfehlt(0.9, 0.98, "min")).toBe(true);
    expect(verfehlt(0.99, 0.98, "min")).toBe(false);
  });

  it("max: mehr als das Ziel ist schlecht", () => {
    expect(verfehlt(0.2, 0.1, "max")).toBe(true);
    expect(verfehlt(0.05, 0.1, "max")).toBe(false);
  });

  it("genau auf dem Ziel ist nicht verfehlt", () => {
    expect(verfehlt(0.98, 0.98, "min")).toBe(false);
    expect(verfehlt(0.1, 0.1, "max")).toBe(false);
  });

  it("ohne Messwert oder ohne Ziel keine Warnung", () => {
    expect(verfehlt(null, 0.98, "min")).toBe(false);
    expect(verfehlt(0.5, undefined, "min")).toBe(false);
  });
});

describe("nachSchluessel", () => {
  it("macht eine Nachschlagetabelle", () => {
    const tabelle = nachSchluessel([
      { schluessel: "a", wert: 1 },
      { schluessel: "b", wert: 2 },
    ] as never);
    expect(tabelle).toEqual({ a: 1, b: 2 });
  });
});
