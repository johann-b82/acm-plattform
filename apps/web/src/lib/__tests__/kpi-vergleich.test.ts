/**
 * Vergleichswerte an den Kacheln.
 *
 * Die Fenster sind der Teil, bei dem man sich leicht um einen Tag vertut —
 * und ein um einen Tag verschobener Vergleich fällt niemandem auf, er ist nur
 * falsch. Deshalb steht hier jedes Fenster ausgeschrieben.
 */
import { describe, expect, it } from "vitest";

import {
  alsProzent,
  bewertung,
  delta,
  vergleichsfenster,
  vorjahr,
  vorperiode,
} from "@/lib/kpi/vergleich";

describe("Vorperiode", () => {
  it("endet am Tag vor dem Zeitraum und ist gleich lang", () => {
    // 1.–31. März sind 31 Tage; davor also 29. Januar bis 28. Februar.
    expect(vorperiode("2026-03-01", "2026-03-31")).toEqual({
      von: "2026-01-29",
      bis: "2026-02-28",
    });
  });

  it("rechnet auch über den Jahreswechsel",  () => {
    expect(vorperiode("2026-01-01", "2026-01-31")).toEqual({
      von: "2025-12-01",
      bis: "2025-12-31",
    });
  });

  it("kommt mit einem einzigen Tag zurecht", () => {
    expect(vorperiode("2026-03-05", "2026-03-05")).toEqual({
      von: "2026-03-04",
      bis: "2026-03-04",
    });
  });

  it("stolpert nicht über die Sommerzeitumstellung", () => {
    // In der Nacht zum 29. März 2026 wird umgestellt. Mit Mitternacht als
    // Bezug verschöbe sich das Fenster um einen Tag.
    expect(vorperiode("2026-03-29", "2026-04-05")).toEqual({
      von: "2026-03-21",
      bis: "2026-03-28",
    });
  });
});

describe("Vorjahr", () => {
  it("sind 365 Tage, nicht derselbe Kalendertag", () => {
    // 2024 hatte 366 Tage. 365 Tage vor dem 1.1.2025 ist deshalb der 2.1.2024
    // und nicht der 1.1. — genau die Verschiebung, die bewusst hingenommen
    // wird, damit beide Fenster gleich viele Tage umfassen.
    expect(vorjahr("2025-01-01", "2025-01-31")).toEqual({
      von: "2024-01-02",
      bis: "2024-02-01",
    });
  });

  it("ohne Schaltjahr trifft es den Kalendertag", () => {
    expect(vorjahr("2026-06-01", "2026-06-30")).toEqual({
      von: "2025-06-01",
      bis: "2025-06-30",
    });
  });
});

describe("Welche Vergleiche passen", () => {
  it("beim Jahr nur das Vorjahr", () => {
    // Die Vorperiode wäre ein Stück des Vorjahres gleicher Länge — eine Zahl,
    // die niemand erwartet.
    const f = vergleichsfenster("jahr", "2026-01-01", "2026-09-11");
    expect(f.vorperiode).toBeNull();
    expect(f.vorjahr).not.toBeNull();
  });

  it("beim Monat beide", () => {
    const f = vergleichsfenster("monat", "2026-09-01", "2026-09-11");
    expect(f.vorperiode).not.toBeNull();
    expect(f.vorjahr).not.toBeNull();
  });

  it("bei „Alles“ keinen", () => {
    expect(vergleichsfenster("alles", null, null)).toEqual({
      vorperiode: null,
      vorjahr: null,
    });
  });
});

describe("Veränderung", () => {
  it("rechnet relativ", () => {
    expect(delta(110, 100)).toBeCloseTo(0.1);
    expect(delta(90, 100)).toBeCloseTo(-0.1);
  });

  it("gibt nichts zurück, wenn der Vorwert null ist", () => {
    // Von null auf irgendetwas ist keine Prozentangabe.
    expect(delta(50, 0)).toBeNull();
  });

  it("gibt nichts zurück, wenn ein Wert fehlt", () => {
    expect(delta(null, 100)).toBeNull();
    expect(delta(100, undefined)).toBeNull();
  });

  it("rechnet auch bei negativem Vorwert richtig herum", () => {
    // Von -100 auf -50 ist eine Verbesserung um die Hälfte, nicht eine
    // Verschlechterung. Deshalb der Betrag im Nenner.
    expect(delta(-50, -100)).toBeCloseTo(0.5);
  });
});

describe("Bewertung", () => {
  it("mehr ist meistens besser", () => {
    expect(bewertung(0.1)).toBe("gut");
    expect(bewertung(-0.1)).toBe("schlecht");
  });

  it("bei Verzug und Reklamationen andersherum", () => {
    expect(bewertung(-0.1, "weniger_ist_besser")).toBe("gut");
    expect(bewertung(0.1, "weniger_ist_besser")).toBe("schlecht");
  });

  it("ohne Veränderung ohne Farbe", () => {
    expect(bewertung(0)).toBe("neutral");
    expect(bewertung(null)).toBe("neutral");
  });
});

describe("Darstellung", () => {
  it("zeigt das Vorzeichen auch bei Zuwachs", () => {
    // `Intl` setzt vor dem Prozentzeichen ein geschütztes Leerzeichen.
    expect(alsProzent(0.124)).toBe("+12,4\u00a0%");
    expect(alsProzent(-0.124)).toBe("-12,4\u00a0%");
  });

  it("zeigt einen Strich, wenn es nichts zu vergleichen gibt", () => {
    expect(alsProzent(null)).toBe("—");
  });
});
