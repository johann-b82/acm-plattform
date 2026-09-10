import { describe, expect, it } from "vitest";
import { bucketLabel, fenster, fmt, takt } from "../gemeinsam";

describe("Zeitraum in ein Datumsfenster übersetzen", () => {
  const heute = new Date(2026, 4, 17); // 17. Mai 2026

  it("Monat beginnt am Monatsersten", () => {
    expect(fenster("monat", heute)).toEqual({ von: "2026-05-01", bis: "2026-05-17" });
  });

  it("Quartal beginnt am Quartalsersten", () => {
    expect(fenster("quartal", heute)).toEqual({ von: "2026-04-01", bis: "2026-05-17" });
    expect(fenster("quartal", new Date(2026, 0, 5)).von).toBe("2026-01-01");
    expect(fenster("quartal", new Date(2026, 11, 31)).von).toBe("2026-10-01");
  });

  it("Jahr beginnt am 1. Januar", () => {
    expect(fenster("jahr", heute).von).toBe("2026-01-01");
  });

  it("Alles lässt beide Grenzen offen", () => {
    expect(fenster("alles", heute)).toEqual({ von: null, bis: null });
  });
});

describe("Bucket-Breite nach Fensterlänge", () => {
  it("bis 31 Tage täglich, bis 91 wöchentlich, darüber monatlich", () => {
    expect(takt("2026-05-01", "2026-05-31")).toBe("day");
    expect(takt("2026-03-01", "2026-05-17")).toBe("week");
    expect(takt("2026-01-01", "2026-12-31")).toBe("month");
  });

  it("ohne Grenzen monatlich", () => {
    expect(takt(null, null)).toBe("month");
    expect(takt("2026-01-01", null)).toBe("month");
  });
});

describe("Formatierung", () => {
  it("zeigt fehlende Werte als Gedankenstrich statt als 0", () => {
    expect(fmt.eur(null)).toBe("—");
    expect(fmt.zahl(undefined)).toBe("—");
    expect(fmt.prozent(null)).toBe("—");
    // Eine echte 0 ist eine Aussage und wird gezeigt.
    expect(fmt.zahl(0)).toBe("0");
  });

  it("formatiert deutsch", () => {
    expect(fmt.eur(1234567).replace(/ /g, " ")).toBe("1.234.567 €");
    expect(fmt.prozent(0.5455).replace(/ /g, " ")).toBe("54,6 %");
  });
});

describe("Achsenbeschriftung", () => {
  it("Monat kurz, Tag und Woche als Datum", () => {
    expect(bucketLabel("2026-03-01", "month")).toMatch(/Mär|Mar/);
    expect(bucketLabel("2026-03-05", "day")).toBe("05.03.");
  });
});
