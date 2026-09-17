/**
 * Der Umsatzverlauf rechnet in Monaten, auch in der Monatsansicht.
 *
 * Im Tagestakt stand in der Monatsansicht für jeden Tag ein Punkt, während
 * Umsatz nur an wenigen Tagen gebucht wird — die Fläche riss an jedem dieser
 * Tage auf, obwohl keine Zahl fehlte. Das Altprojekt rechnet den Verlauf
 * deshalb immer monatsweise (`RevenueChart.tsx`, `GRANULARITY = "monthly"`).
 */
import { describe, expect, it } from "vitest";

import { takt } from "@/lib/kpi/gemeinsam";
import { UMSATZ_TAKT, verlaufMitVergleich } from "@/lib/kpi/vertrieb";

/** Ein September, in dem an einem einzigen Tag gebucht wurde. */
const SEPTEMBER = { von: "2026-09-01", bis: "2026-09-17" };
const AUGUST = { von: "2026-08-01", bis: "2026-08-17" };
const EINE_BUCHUNG = [{ bucket: "2026-09-01", umsatz: 47937.63 }];

describe("Takt des Umsatzverlaufs", () => {
  it("bleibt Monat, auch wo der Fenstertakt Tage vorsähe", () => {
    expect(takt(SEPTEMBER.von, SEPTEMBER.bis)).toBe("day");
    expect(UMSATZ_TAKT).toBe("month");
  });

  it("macht aus der Monatsansicht einen Punkt ohne Lücke", () => {
    const zeilen = verlaufMitVergleich(EINE_BUCHUNG, null, SEPTEMBER, null, UMSATZ_TAKT);
    expect(zeilen).toEqual([{ bucket: "2026-09-01", umsatz: 47937.63 }]);
  });

  it("im Tagestakt entstünden dagegen 16 leere Punkte", () => {
    const zeilen = verlaufMitVergleich(EINE_BUCHUNG, null, SEPTEMBER, null, "day");
    expect(zeilen).toHaveLength(17);
    expect(zeilen.filter((z) => z.umsatz === null)).toHaveLength(16);
  });

  it("stellt den Vormonat als eigenen Punkt daneben", () => {
    const zeilen = verlaufMitVergleich(
      EINE_BUCHUNG,
      [{ bucket: "2026-08-01", umsatz: 31000 }],
      SEPTEMBER,
      AUGUST,
      UMSATZ_TAKT,
    );
    expect(zeilen).toEqual([
      { bucket: "2026-09-01", umsatz: 47937.63, vorher: 31000, bucketVorher: "2026-08-01" },
    ]);
  });

  it("im Jahr bleibt es bei zwölf Monaten", () => {
    const zeilen = verlaufMitVergleich(
      EINE_BUCHUNG,
      null,
      { von: "2026-01-01", bis: "2026-12-31" },
      null,
      UMSATZ_TAKT,
    );
    expect(zeilen).toHaveLength(12);
    expect(zeilen.find((z) => z.bucket === "2026-09-01")?.umsatz).toBe(47937.63);
  });
});
