import { describe, expect, it } from "vitest";

import {
  alsCsv,
  alsTsv,
  ausDrehung,
  inDrehung,
  ballonPixel,
  begrenze01,
  einpassen,
  gedrehteMasse,
  naechsteDrehung,
  randpunkt,
  rechteckAusEcken,
  runde6,
  zoomeUm,
  zuBildschirm,
  zuNormiert,
} from "@/lib/fair/geometrie";

const ANSICHT = { skala: 2, tx: 30, ty: 10 };

describe("Umrechnung Bildschirm ↔ Seite", () => {
  it("kehrt sich selbst um", () => {
    const p = { x: 0.3, y: 0.75 };
    const s = zuBildschirm(p, ANSICHT, 800, 600);
    const zurueck = zuNormiert(s.x, s.y, ANSICHT, 800, 600);
    expect(zurueck.x).toBeCloseTo(p.x, 9);
    expect(zurueck.y).toBeCloseTo(p.y, 9);
  });

  it("begrenzt auf die Seite", () => {
    // Weit links oben neben der Seite geklickt.
    expect(zuNormiert(-500, -500, ANSICHT, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(zuNormiert(99999, 99999, ANSICHT, 800, 600)).toEqual({ x: 1, y: 1 });
  });

  it("begrenze01 lässt Werte dazwischen in Ruhe", () => {
    expect(begrenze01(0.42)).toBe(0.42);
  });
});

describe("Rechteck aus Ecken", () => {
  it("richtet sich nach der Ziehrichtung nicht", () => {
    const a = { x: 0.8, y: 0.9 };
    const b = { x: 0.2, y: 0.1 };
    expect(rechteckAusEcken(a, b)).toEqual(rechteckAusEcken(b, a));
    const r = rechteckAusEcken(a, b);
    expect(r.x).toBeCloseTo(0.2, 9);
    expect(r.y).toBeCloseTo(0.1, 9);
    expect(r.b).toBeCloseTo(0.6, 9);
    expect(r.h).toBeCloseTo(0.8, 9);
  });
});

describe("Einpassen und Zoomen", () => {
  it("legt die ganze Seite mittig ins Fenster", () => {
    const a = einpassen(1000, 800, 400, 200, 0);
    expect(a.skala).toBe(2.5); // Breite ist die Grenze: 1000/400
    expect(a.tx).toBe(0);
    expect(a.ty).toBe((800 - 200 * 2.5) / 2);
  });

  it("lässt beim Zoomen den Punkt unter dem Zeiger liegen", () => {
    const vorher = zuNormiert(400, 300, ANSICHT, 800, 600);
    const nachher = zuNormiert(400, 300, zoomeUm(ANSICHT, 400, 300, 1.7), 800, 600);
    expect(nachher.x).toBeCloseTo(vorher.x, 9);
    expect(nachher.y).toBeCloseTo(vorher.y, 9);
  });

  it("hält die Skala in ihren Grenzen", () => {
    expect(zoomeUm(ANSICHT, 0, 0, 1000).skala).toBe(12);
    expect(zoomeUm(ANSICHT, 0, 0, 0.00001).skala).toBe(0.1);
  });
});

describe("Drehung", () => {
  it("dreht im Kreis", () => {
    expect(naechsteDrehung(naechsteDrehung(naechsteDrehung(naechsteDrehung(0))))).toBe(0);
  });

  it("tauscht die Maße im Hochkant", () => {
    expect(gedrehteMasse(400, 200, 90)).toEqual({ b: 200, h: 400 });
    expect(gedrehteMasse(400, 200, 180)).toEqual({ b: 400, h: 200 });
  });

  it("rechnet aus dem gedrehten Kasten zurück in kanonische Punkte", () => {
    // Bei 90° wird die linke obere Ecke der Seite zur rechten oberen des Kastens.
    expect(ausDrehung(200, 0, 400, 200, 90)).toEqual({ x: 0, y: 0 });
    expect(ausDrehung(0, 0, 400, 200, 180)).toEqual({ x: 400, y: 200 });
  });
});

describe("Ballon", () => {
  const b = {
    bereich_x: 0.4,
    bereich_y: 0.4,
    bereich_b: 0.2,
    bereich_h: 0.1,
    blase_x: 0.9,
    blase_y: 0.5,
  };

  it("setzt die Spitze außerhalb des markierten Felds", () => {
    const p = ballonPixel(b, 1000, 1000);
    // Feld: x 400–600, y 400–500, Mitte (500, 450). Die Blase liegt bei
    // (900, 500), der Strahl verlässt das Feld also an der rechten Kante und
    // etwas unterhalb der Mitte — die Spitze sitzt knapp dahinter.
    expect(p.spitze.x).toBeGreaterThan(600);
    expect(p.spitze.y).toBeGreaterThan(450);
    expect(p.spitze.y).toBeLessThan(500);
  });

  it("verdeckt das markierte Feld nicht", () => {
    // Egal, wo die Blase liegt: die Spitze bleibt draußen.
    for (const [bx, by] of [[0.05, 0.05], [0.95, 0.05], [0.5, 0.95], [0.05, 0.5]]) {
      const p = ballonPixel({ ...b, blase_x: bx, blase_y: by }, 1000, 1000);
      const drin =
        p.spitze.x > p.bereich.x &&
        p.spitze.x < p.bereich.x + p.bereich.b &&
        p.spitze.y > p.bereich.y &&
        p.spitze.y < p.bereich.y + p.bereich.h;
      expect(drin).toBe(false);
    }
  });

  it("skaliert den Radius mit der Seite", () => {
    expect(ballonPixel(b, 2000, 2000).r).toBeGreaterThan(ballonPixel(b, 500, 500).r);
  });

  it("hält einen Mindestradius ein, damit die Nummer lesbar bleibt", () => {
    expect(ballonPixel(b, 50, 50).r).toBe(9);
  });

  it("randpunkt gibt bei gleichem Punkt die Mitte zurück", () => {
    expect(randpunkt(10, 10, 5, 5, { x: 10, y: 10 }, 3)).toEqual({ x: 10, y: 10 });
  });
});

describe("Ausgabe für die Prüfliste", () => {
  const zeilen = [
    { nummer: 2, wert: "40 ±0,1" },
    { nummer: 1, wert: "12,0\th7" },
  ];

  it("sortiert nach Nummer und ersetzt Tabulatoren im Wert", () => {
    expect(alsTsv(zeilen)).toBe("Nr\tWert\r\n1\t12,0 h7\r\n2\t40 ±0,1");
  });

  it("trennt mit Semikolon und verdoppelt Anführungszeichen", () => {
    expect(alsCsv([{ nummer: 1, wert: 'R 5 "innen"' }])).toBe(
      '"Nr";"Wert"\r\n1;"R 5 ""innen"""',
    );
  });
});

describe("runde6", () => {
  it("rundet auf sechs Stellen", () => {
    expect(runde6(0.12345678)).toBe(0.123457);
  });
});

describe("Drehung für die PDF-Ausgabe", () => {
  it("inDrehung kehrt ausDrehung für alle vier Lagen um", () => {
    for (const d of [0, 90, 180, 270] as const) {
      const g = inDrehung(120, 45, 800, 600, d);
      const k = ausDrehung(g.x, g.y, 800, 600, d);
      expect([k.x, k.y]).toEqual([120, 45]);
    }
  });

  it("legt die linke obere Ecke bei 90° an den rechten Rand", () => {
    // 800×600 im Uhrzeigersinn gedreht wird 600×800; oben links wandert nach oben rechts.
    expect(inDrehung(0, 0, 800, 600, 90)).toEqual({ x: 600, y: 0 });
  });
});
