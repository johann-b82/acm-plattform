/**
 * Vergleichswerte an den Kacheln (KPI-05/06, VER-02).
 *
 * Die Fenster folgen dem Kalender wie im Altsystem: „Dieser Monat“ bis zum
 * 12. wird mit dem Vormonat bis zum 12. verglichen, nicht mit den zwölf Tagen
 * unmittelbar davor. Nur so stimmt die Beschriftung „zum August“.
 *
 * Die Fenster sind der Teil, bei dem man sich leicht um einen Tag vertut —
 * deshalb steht hier jedes Fenster ausgeschrieben.
 */
import { describe, expect, it } from "vitest";

import {
  alsProzent,
  beschriftungen,
  bewertung,
  delta,
  vergleichsfenster,
} from "@/lib/kpi/vergleich";

const WORTE = {
  zu: (was: string) => `zum ${was}`,
  quartal: (q: number) => `${q}. Quartal`,
  jahr: (j: number) => `Jahr ${j}`,
};

describe("Monat", () => {
  it("vergleicht mit dem Vormonat bis zum selben Tag und dem Vorjahresmonat", () => {
    expect(vergleichsfenster("monat", "2026-09-01", "2026-09-12")).toEqual({
      vorperiode: { von: "2026-08-01", bis: "2026-08-12" },
      vorjahr: { von: "2025-09-01", bis: "2025-09-12" },
    });
    expect(beschriftungen("monat", "2026-09-01", "2026-09-12", "de-DE", WORTE)).toEqual({
      vorperiode: "zum August",
      vorjahr: "zum September 2025",
    });
  });

  it("bleibt am Monatsende im Vormonat", () => {
    // Der 31. März hat im Februar keine Entsprechung; das Altsystem lief hier
    // in den März hinein.
    expect(vergleichsfenster("monat", "2026-03-01", "2026-03-31").vorperiode).toEqual({
      von: "2026-02-01",
      bis: "2026-02-28",
    });
  });

  it("nennt über den Jahreswechsel das Jahr", () => {
    expect(vergleichsfenster("monat", "2026-01-01", "2026-01-10").vorperiode).toEqual({
      von: "2025-12-01",
      bis: "2025-12-10",
    });
    expect(beschriftungen("monat", "2026-01-01", "2026-01-10", "de-DE", WORTE).vorperiode).toBe(
      "zum Dezember 2025",
    );
  });
});

describe("Quartal", () => {
  it("vergleicht mit dem Vorquartal bis zum selben Tag", () => {
    expect(vergleichsfenster("quartal", "2026-07-01", "2026-09-12")).toEqual({
      vorperiode: { von: "2026-04-01", bis: "2026-06-13" },
      vorjahr: { von: "2025-07-01", bis: "2025-09-12" },
    });
    expect(beschriftungen("quartal", "2026-07-01", "2026-09-12", "de-DE", WORTE)).toEqual({
      vorperiode: "zum 2. Quartal",
      vorjahr: "zum 3. Quartal 2025",
    });
  });

  it("rollt vom ersten ins vierte Quartal des Vorjahres", () => {
    expect(beschriftungen("quartal", "2026-01-01", "2026-03-31", "de-DE", WORTE).vorperiode).toBe(
      "zum 4. Quartal 2025",
    );
    expect(vergleichsfenster("quartal", "2026-01-01", "2026-03-31").vorperiode).toEqual({
      von: "2025-10-01",
      bis: "2025-12-29",
    });
  });
});

describe("Jahr", () => {
  it("hat nur den Vorjahresvergleich", () => {
    expect(vergleichsfenster("jahr", "2026-01-01", "2026-09-12")).toEqual({
      vorperiode: null,
      vorjahr: { von: "2025-01-01", bis: "2025-09-12" },
    });
    expect(beschriftungen("jahr", "2026-01-01", "2026-09-12", "de-DE", WORTE)).toEqual({
      vorperiode: null,
      vorjahr: "zum Jahr 2025",
    });
  });

  it("macht aus dem 29. Februar im Vorjahr den 28.", () => {
    expect(vergleichsfenster("jahr", "2024-01-01", "2024-02-29").vorjahr).toEqual({
      von: "2023-01-01",
      bis: "2023-02-28",
    });
  });
});

describe("Freier Zeitraum", () => {
  it("vergleicht mit dem gleich langen Zeitraum davor und nennt ihn", () => {
    expect(vergleichsfenster("frei", "2026-03-10", "2026-03-19")).toEqual({
      vorperiode: { von: "2026-02-28", bis: "2026-03-09" },
      vorjahr: { von: "2025-03-10", bis: "2025-03-19" },
    });
    expect(beschriftungen("frei", "2026-03-10", "2026-03-19", "de-DE", WORTE)).toEqual({
      vorperiode: "zum 28.02.2026–09.03.2026",
      vorjahr: "zum 10.03.2025–19.03.2025",
    });
  });

  it("stolpert nicht über die Sommerzeitumstellung", () => {
    expect(vergleichsfenster("frei", "2026-03-29", "2026-04-05").vorperiode).toEqual({
      von: "2026-03-21",
      bis: "2026-03-28",
    });
  });
});

describe("Alles", () => {
  it("hat keinen Vergleich", () => {
    expect(vergleichsfenster("alles", null, null)).toEqual({ vorperiode: null, vorjahr: null });
    expect(beschriftungen("alles", null, null, "de-DE", WORTE)).toEqual({
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

  it("unterscheidet unverändert von fehlend", () => {
    expect(delta(100, 100)).toBe(0);
    expect(delta(50, 0)).toBeNull();
    expect(delta(null, 100)).toBeNull();
    expect(delta(100, undefined)).toBeNull();
  });

  it("rechnet auch bei negativem Vorwert richtig herum", () => {
    // Von -100 auf -50 ist eine Verbesserung um die Hälfte.
    expect(delta(-50, -100)).toBeCloseTo(0.5);
  });
});

describe("Bewertung", () => {
  it("mehr ist besser, wo es so gemeint ist", () => {
    expect(bewertung(0.1)).toBe("gut");
    expect(bewertung(-0.1)).toBe("schlecht");
  });

  it("steigende Personalkostenquote ist schlecht, fallende gut", () => {
    expect(bewertung(0.1, "weniger_ist_besser")).toBe("schlecht");
    expect(bewertung(-0.1, "weniger_ist_besser")).toBe("gut");
  });

  it("ohne fachliche Bewertung, ohne Veränderung oder ohne Wert bleibt es neutral", () => {
    expect(bewertung(0.5, "neutral")).toBe("neutral");
    expect(bewertung(0)).toBe("neutral");
    expect(bewertung(null)).toBe("neutral");
  });
});

describe("Darstellung", () => {
  it("zeigt den Betrag der Veränderung ohne Vorzeichen — die Richtung trägt der Pfeil", () => {
    expect(alsProzent(0.124, "de-DE")).toBe("12,4 %");
    expect(alsProzent(-0.124, "de-DE")).toBe("12,4 %");
  });

  it("zeigt einen Strich, wenn es nichts zu vergleichen gibt", () => {
    expect(alsProzent(null, "de-DE")).toBe("—");
  });
});
