import { describe, expect, it } from "vitest";

import { wochenfenster } from "../vertrieb";

describe("Wochenfenster der Vertriebsaktivität", () => {
  it("übernimmt einen gewählten Zeitraum unverändert", () => {
    expect(wochenfenster("2026-01-01", "2026-03-31")).toEqual({
      von: "2026-01-01",
      bis: "2026-03-31",
    });
  });

  it("fällt ohne Zeitraum auf zwölf Wochen bis zum Sonntag zurück", () => {
    // Donnerstag, 17. September 2026 → Sonntag dieser Woche ist der 20.
    const { von, bis } = wochenfenster(null, null, new Date(2026, 8, 17));
    expect(bis).toBe("2026-09-20");
    // 12 Wochen sind 84 Tage; der erste Montag liegt 83 Tage vor dem Sonntag.
    expect(von).toBe("2026-06-29");
    const tage = (new Date(bis).getTime() - new Date(von).getTime()) / 86_400_000;
    expect(tage).toBe(83);
  });

  it("rechnet am Sonntag nicht eine Woche weiter", () => {
    // Sonntag, 20. September 2026. Der Sonntag der laufenden Woche ist er selbst.
    const { bis } = wochenfenster(null, null, new Date(2026, 8, 20));
    expect(bis).toBe("2026-09-20");
  });

  it("rechnet am Montag bis zum Sonntag derselben Woche", () => {
    const { bis } = wochenfenster(null, null, new Date(2026, 8, 14));
    expect(bis).toBe("2026-09-20");
  });

  it("bleibt in der lokalen Zeitzone", () => {
    // Am 1. Januar 00:00 lokal ergäbe toISOString() den 31. Dezember.
    const { bis } = wochenfenster(null, null, new Date(2026, 0, 1));
    expect(bis).toBe("2026-01-04");
  });
});
