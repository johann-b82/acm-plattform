/**
 * Vollständig laden trotz Seitengrenze (UPL-02): PostgREST gibt höchstens
 * 1000 Zeilen je Anfrage heraus. Wer nur einmal fragt, zeigt still eine
 * abgeschnittene Historie.
 */
import { describe, expect, it } from "vitest";

import { ladeAlle } from "@/lib/seitenweise";

function quelle(gesamt: number, maximum = 1000) {
  const aufrufe: [number, number][] = [];
  const holen = async (von: number, bis: number) => {
    aufrufe.push([von, bis]);
    const ende = Math.min(bis, gesamt - 1, von + maximum - 1);
    return Array.from({ length: Math.max(0, ende - von + 1) }, (_, i) => von + i);
  };
  return { holen, aufrufe };
}

describe("ladeAlle", () => {
  it("holt über mehrere Seiten alles, in der Reihenfolge der Quelle", async () => {
    const { holen, aufrufe } = quelle(2500);
    const zeilen = await ladeAlle(holen, 1000);
    expect(zeilen).toHaveLength(2500);
    expect(zeilen[0]).toBe(0);
    expect(zeilen[2499]).toBe(2499);
    expect(aufrufe).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ]);
  });

  it("fragt bei genau voller letzter Seite noch einmal und hört bei leer auf", async () => {
    const { holen, aufrufe } = quelle(2000);
    expect(await ladeAlle(holen, 1000)).toHaveLength(2000);
    expect(aufrufe).toHaveLength(3);
  });

  it("kommt mit einer leeren Quelle zurecht", async () => {
    const { holen } = quelle(0);
    expect(await ladeAlle(holen, 1000)).toEqual([]);
  });

  it("merkt, wenn der Server kleinere Seiten liefert als erbeten", async () => {
    // Server-Maximum 1000, erbeten 5000: eine kurze Seite ist kein Ende.
    const { holen } = quelle(2300, 1000);
    expect(await ladeAlle(holen, 5000)).toHaveLength(2300);
  });
});
