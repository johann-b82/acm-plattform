/**
 * Der Umsatzverlauf: im gewählten Monat nach Kalenderwochen, sonst monatlich.
 *
 * Im Tagestakt stand in der Monatsansicht für jeden Tag ein Punkt, während
 * Umsatz nur an wenigen Tagen gebucht wird — die Fläche riss auf. Die Referenz
 * zeigt den Monat deshalb wochenweise (vier bis fünf Punkte), größere Fenster
 * monatsweise. Der Vergleich läuft gegen die Vorjahresperiode.
 */
import { describe, expect, it } from "vitest";

import { takt } from "@/lib/kpi/gemeinsam";
import { umsatzTakt, verlaufMitVergleich, zeitachse } from "@/lib/kpi/vertrieb";

const SEPTEMBER = { von: "2026-09-01", bis: "2026-09-30" };
const SEPTEMBER_VORJAHR = { von: "2025-09-01", bis: "2025-09-30" };

describe("Takt des Umsatzverlaufs", () => {
  it("ist im Monat die Kalenderwoche, sonst der Monat", () => {
    expect(umsatzTakt("monat")).toBe("week");
    expect(umsatzTakt("quartal")).toBe("month");
    expect(umsatzTakt("jahr")).toBe("month");
    expect(umsatzTakt("frei")).toBe("month");
    expect(umsatzTakt("alles")).toBe("month");
  });

  it("teilt den gewählten Monat in Kalenderwochen statt in einen Punkt", () => {
    const wochen = zeitachse(SEPTEMBER.von, SEPTEMBER.bis, "week");
    expect(wochen.length).toBeGreaterThanOrEqual(4); // September berührt vier bis fünf KW
    const buchung = [{ bucket: wochen[0], umsatz: 47937.63 }];
    const zeilen = verlaufMitVergleich(buchung, null, SEPTEMBER, null, "week");
    expect(zeilen).toHaveLength(wochen.length);
    expect(zeilen[0]).toEqual({ bucket: wochen[0], umsatz: 47937.63 });
    // Die Buckets liegen eine Woche auseinander.
    const tage = (new Date(zeilen[1].bucket).getTime() - new Date(zeilen[0].bucket).getTime()) / 86_400_000;
    expect(tage).toBe(7);
  });

  it("im Tagestakt entstünden dagegen ~30 großteils leere Punkte", () => {
    const buchung = [{ bucket: "2026-09-01", umsatz: 47937.63 }];
    const zeilen = verlaufMitVergleich(buchung, null, SEPTEMBER, null, "day");
    expect(zeilen).toHaveLength(30);
    expect(zeilen.filter((z) => z.umsatz === null)).toHaveLength(29);
  });

  it("stellt die Vorjahres-Kalenderwoche als eigene Reihe daneben", () => {
    const wochen = zeitachse(SEPTEMBER.von, SEPTEMBER.bis, "week");
    const wochenVor = zeitachse(SEPTEMBER_VORJAHR.von, SEPTEMBER_VORJAHR.bis, "week");
    const zeilen = verlaufMitVergleich(
      [{ bucket: wochen[0], umsatz: 47937.63 }],
      [{ bucket: wochenVor[0], umsatz: 31000 }],
      SEPTEMBER,
      SEPTEMBER_VORJAHR,
      "week",
    );
    expect(zeilen[0].umsatz).toBe(47937.63);
    expect(zeilen[0].vorher).toBe(31000);
    expect(zeilen[0].bucketVorher).toBe(wochenVor[0]);
  });

  it("im Jahr bleibt es bei zwölf Monaten", () => {
    const zeilen = verlaufMitVergleich(
      [{ bucket: "2026-09-01", umsatz: 47937.63 }],
      null,
      { von: "2026-01-01", bis: "2026-12-31" },
      null,
      "month",
    );
    expect(zeilen).toHaveLength(12);
    expect(zeilen.find((z) => z.bucket === "2026-09-01")?.umsatz).toBe(47937.63);
  });

  // Sicherheitsnetz: der fensterabhängige Grundtakt sähe im September Tage vor.
  it("der Fenstertakt allein sähe Tage vor — deshalb der eigene Umsatztakt", () => {
    expect(takt(SEPTEMBER.von, SEPTEMBER.bis)).toBe("day");
  });
});
