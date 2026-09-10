import { describe, expect, it } from "vitest";

import { intervallText, laufendesHalbjahr } from "@/lib/wartung";

describe("intervallText", () => {
  it("nennt bekannte Intervalle beim Namen", () => {
    expect(intervallText({ intervall: "quartalsweise", wochen: null })).toBe("Quartalsweise");
  });

  it("nimmt die Zahl mit, wo eine dazugehört", () => {
    expect(intervallText({ intervall: "alle_n_wochen", wochen: 6 })).toBe("Alle 6 Wochen");
  });

  it("fällt nicht auf die Nase, wenn die Zahl fehlt", () => {
    // Die Datenbank lässt das nicht zu; die Oberfläche soll trotzdem etwas
    // Lesbares zeigen statt „Alle null Wochen".
    expect(intervallText({ intervall: "alle_n_wochen", wochen: null })).toBe("Alle N Wochen");
  });
});

describe("laufendesHalbjahr", () => {
  it("nimmt im Juni noch das erste", () => {
    expect(laufendesHalbjahr(new Date("2026-06-30T12:00:00"))).toEqual({
      jahr: 2026,
      halbjahr: 1,
    });
  });

  it("ab Juli das zweite", () => {
    expect(laufendesHalbjahr(new Date("2026-07-01T12:00:00"))).toEqual({
      jahr: 2026,
      halbjahr: 2,
    });
  });
});
