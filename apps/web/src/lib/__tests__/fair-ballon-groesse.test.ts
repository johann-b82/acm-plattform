import { describe, expect, it } from "vitest";

import {
  BALLON_GROESSE_MAX,
  BALLON_GROESSE_MIN,
  ballonGroesseAus,
  groesser,
  kleiner,
} from "@/lib/fair/ballon-groesse";
import { ballonPixel } from "@/lib/fair/geometrie";

const B = { bereich_x: 0.1, bereich_y: 0.1, bereich_b: 0.1, bereich_h: 0.05, blase_x: 0.5, blase_y: 0.5 };

describe("Bubblegröße (FAI-04)", () => {
  it("wächst und schrumpft in Schritten von 18 % wie im Altsystem", () => {
    expect(groesser(1)).toBeCloseTo(1.18, 9);
    expect(kleiner(1)).toBeCloseTo(1 / 1.18, 9);
  });

  it("bleibt zwischen 0,4 und 3", () => {
    expect(groesser(2.9)).toBe(BALLON_GROESSE_MAX);
    expect(kleiner(0.41)).toBe(BALLON_GROESSE_MIN);
  });

  it("liest den gespeicherten Wert und fällt bei Unsinn auf 1 zurück", () => {
    expect(ballonGroesseAus("1.5")).toBe(1.5);
    expect(ballonGroesseAus(null)).toBe(1);
    expect(ballonGroesseAus("abc")).toBe(1);
    expect(ballonGroesseAus("-2")).toBe(1);
    expect(ballonGroesseAus("99")).toBe(BALLON_GROESSE_MAX);
  });

  it("vergrößert Blase und Nummer gemeinsam, lässt Lage und Feld unverändert", () => {
    const normal = ballonPixel(B, 1000, 800, 1);
    const gross = ballonPixel(B, 1000, 800, 2);
    expect(gross.r).toBeCloseTo(normal.r * 2, 9);
    expect(gross.schriftgroesse).toBeCloseTo(normal.schriftgroesse * 2, 9);
    expect(gross.blase).toEqual(normal.blase);
    expect(gross.bereich).toEqual(normal.bereich);
  });
});
