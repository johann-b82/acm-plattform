import { describe, expect, it } from "vitest";

import { prozente } from "@/lib/kpi/personal";

/**
 * Ganzzahlige Prozente, die sich zu genau 100 addieren. Ohne die
 * Größter-Rest-Methode zeigt eine Verteilung aus drei Dritteln 99 Prozent.
 */
describe("Prozente nach größtem Rest", () => {
  const summe = (w: { prozent: number }[]) => w.reduce((s, x) => s + x.prozent, 0);

  it("drei Drittel ergeben zusammen 100", () => {
    const p = prozente([{ anzahl: 1 }, { anzahl: 1 }, { anzahl: 1 }]);
    expect(summe(p)).toBe(100);
    expect(p.map((x) => x.prozent).sort()).toEqual([33, 33, 34]);
  });

  it("glatte Werte bleiben glatt", () => {
    const p = prozente([{ anzahl: 1 }, { anzahl: 1 }, { anzahl: 2 }]);
    expect(p.map((x) => x.prozent)).toEqual([25, 25, 50]);
  });

  it("der größte Rest bekommt das übrige Prozent", () => {
    // 7 von 9 = 77,78 → Rest 0,78; 2 von 9 = 22,22 → Rest 0,22
    const p = prozente([{ anzahl: 7 }, { anzahl: 2 }]);
    expect(p.map((x) => x.prozent)).toEqual([78, 22]);
    expect(summe(p)).toBe(100);
  });

  it("leere Menge ergibt null Prozent, nicht NaN", () => {
    expect(prozente([{ anzahl: 0 }, { anzahl: 0 }]).map((x) => x.prozent)).toEqual([0, 0]);
    expect(prozente([])).toEqual([]);
  });

  it("behält die übrigen Felder", () => {
    const p = prozente([{ kategorie: "weiblich", anzahl: 1 }, { kategorie: "männlich", anzahl: 1 }]);
    expect(p[0].kategorie).toBe("weiblich");
  });

  it("addiert sich auch bei vielen Kategorien auf 100", () => {
    const werte = [1, 1, 1, 1, 1, 1, 1].map((anzahl) => ({ anzahl }));
    expect(summe(prozente(werte))).toBe(100);
  });
});
