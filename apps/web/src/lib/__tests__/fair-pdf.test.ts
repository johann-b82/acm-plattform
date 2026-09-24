import { describe, expect, it } from "vitest";

import { prueflistePdf, type PrueflisteEingabe } from "@/lib/fair/pdf";

function ballon(nummer: number, wert: string, seite = 1) {
  return {
    id: `b${nummer}`,
    zeichnung_id: "z",
    nummer,
    seite,
    bereich_x: 0.1,
    bereich_y: 0.2,
    bereich_b: 0.1,
    bereich_h: 0.05,
    blase_x: 0.5,
    blase_y: 0.5,
    wert,
  };
}

function eingabe(teil: Partial<PrueflisteEingabe> = {}): PrueflisteEingabe {
  const ballons = [ballon(2, "Ø 12,0 h7"), ballon(1, "25 ±0,1")];
  return {
    name: "Welle 4711",
    kopf: [
      ["Kunde", "Pilatus"],
      ["Artikelnr.", null],
      ["P/N", "4711-01"],
    ],
    spalten: { nr: "Nr", seite: "Seite", wert: "Wert" },
    pruefliste: "Prüfliste",
    ballons,
    ...teil,
  };
}

const text = (doc: ReturnType<typeof prueflistePdf>) => doc.output();

describe("Prüfliste als PDF (FAI-02)", () => {
  it("ist ein A4-Hochformat", () => {
    const doc = prueflistePdf(eingabe());
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(595.28, 1);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(841.89, 1);
  });

  it("schreibt Kopfdaten und die Werte in Nummernfolge", () => {
    const inhalt = text(prueflistePdf(eingabe()));
    expect(inhalt).toContain("(Welle 4711)");
    expect(inhalt).toContain("(Pilatus)");
    expect(inhalt).toContain("(4711-01)");
    expect(inhalt.indexOf("(25 \\2610,1)") >= 0 || inhalt.indexOf("(25 ±0,1)") >= 0).toBe(true);
    // Nummer 1 steht vor Nummer 2, obwohl die Ballons umgekehrt kamen.
    const eins = inhalt.search(/\(25 /);
    const zwei = inhalt.search(/\(\S+ 12,0 h7\)/);
    expect(eins).toBeGreaterThan(0);
    expect(zwei).toBeGreaterThan(eins);
  });

  it("bricht eine lange Prüfliste auf weitere Seiten um", () => {
    const viele = Array.from({ length: 124 }, (_, i) => ballon(i + 1, `Wert ${i + 1}`));
    const doc = prueflistePdf(eingabe({ ballons: viele }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(text(doc)).toContain("(Wert 124)");
  });
});
