import { describe, expect, it } from "vitest";

import { pruefberichtPdf, type PdfEingabe } from "@/lib/fair/pdf";

// 1×1 weißes PNG.
const BILD =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

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

function eingabe(teil: Partial<PdfEingabe> = {}): PdfEingabe {
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
    seiten: [{ bild: BILD, breite: 800, hoehe: 600 }],
    ballons,
    drehung: 0,
    groesse: 1,
    ...teil,
  };
}

const text = (doc: ReturnType<typeof pruefberichtPdf>) => doc.output();

describe("PDF der ballonierten Zeichnung mit Prüfliste (FAI-02)", () => {
  it("hat je Zeichnungsseite eine Seite in deren Größe und danach die Prüfliste", () => {
    const doc = pruefberichtPdf(eingabe());
    expect(doc.getNumberOfPages()).toBe(2);
    doc.setPage(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(800, 3);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(600, 3);
  });

  it("dreht die Seite mit der Ansicht", () => {
    const doc = pruefberichtPdf(eingabe({ drehung: 90 }));
    doc.setPage(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(600, 3);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(800, 3);
  });

  it("schreibt Kopfdaten und die Werte in Nummernfolge", () => {
    const inhalt = text(pruefberichtPdf(eingabe()));
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
    const doc = pruefberichtPdf(eingabe({ ballons: viele }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
    expect(text(doc)).toContain("(Wert 124)");
  });

  it("zeichnet nur die Ballons der jeweiligen Seite auf die Zeichnung", () => {
    const zweiSeiten = eingabe({
      seiten: [
        { bild: BILD, breite: 800, hoehe: 600 },
        { bild: BILD, breite: 800, hoehe: 600 },
      ],
      ballons: [ballon(1, "a", 1), ballon(2, "b", 2), ballon(3, "c", 2)],
    });
    const doc = pruefberichtPdf(zweiSeiten);
    expect(doc.getNumberOfPages()).toBe(3);
    // Die Inhaltsströme stehen in Seitenfolge; die Nummer steht als Text in der Blase.
    const stroeme = [...text(doc).matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);
    expect(stroeme[0]).toContain("(1) Tj");
    expect(stroeme[0]).not.toContain("(2) Tj");
    expect(stroeme[1]).toContain("(2) Tj");
    expect(stroeme[1]).toContain("(3) Tj");
    expect(stroeme[1]).not.toContain("(1) Tj");
  });
});
