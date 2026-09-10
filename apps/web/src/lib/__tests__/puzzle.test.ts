import { describe, expect, it } from "vitest";
import { packeRaster } from "@/lib/newsletter/puzzle";

describe("packeRaster", () => {
  it("legt vier Einzelbilder nebeneinander in eine Zeile", () => {
    const { platz, zeilen } = packeRaster(Array(4).fill({ spalten: 1, zeilen: 1 }));
    expect(zeilen).toBe(1);
    expect(platz.map((p) => p.spalteVon)).toEqual([1, 2, 3, 4]);
    expect(platz.every((p) => p.zeileVon === 1)).toBe(true);
  });

  it("bricht um, wenn die Zeile voll ist", () => {
    const { platz, zeilen } = packeRaster(Array(5).fill({ spalten: 1, zeilen: 1 }));
    expect(zeilen).toBe(2);
    expect(platz[4]).toEqual({ spalteVon: 1, zeileVon: 2, spalten: 1, zeilen: 1 });
  });

  it("füllt die Lücke neben einem hohen Bild", () => {
    // Ein 2×2 links, danach drei Einzelbilder: zwei passen rechts oben
    // daneben, das dritte rechts darunter — nicht in einer neuen Zeile.
    const { platz, zeilen } = packeRaster([
      { spalten: 2, zeilen: 2 },
      { spalten: 1, zeilen: 1 },
      { spalten: 1, zeilen: 1 },
      { spalten: 1, zeilen: 1 },
    ]);
    expect(zeilen).toBe(2);
    expect(platz[1]).toEqual({ spalteVon: 3, zeileVon: 1, spalten: 1, zeilen: 1 });
    expect(platz[2]).toEqual({ spalteVon: 4, zeileVon: 1, spalten: 1, zeilen: 1 });
    expect(platz[3]).toEqual({ spalteVon: 3, zeileVon: 2, spalten: 1, zeilen: 1 });
  });

  it("kappt eine Spanne, die breiter als das Raster ist", () => {
    const { platz } = packeRaster([{ spalten: 9, zeilen: 1 }]);
    expect(platz[0].spalten).toBe(4);
  });

  it("liefert für dieselbe Eingabe immer dieselbe Anordnung", () => {
    const teile = [
      { spalten: 2, zeilen: 1 },
      { spalten: 1, zeilen: 2 },
      { spalten: 3, zeilen: 1 },
      { spalten: 1, zeilen: 1 },
    ];
    expect(packeRaster(teile)).toEqual(packeRaster(teile));
  });
});
