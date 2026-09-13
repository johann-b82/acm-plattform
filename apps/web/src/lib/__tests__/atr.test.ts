import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));

import {
  formatPoPos,
  gewichtAusEingabe,
  intervallAusEingabe,
  ladeAlle,
  seriennummernAbweichung,
  seriennummernAusText,
} from "@/lib/atr";

describe("formatPoPos", () => {
  // Wie `formatPoPos` im Altsystem (frontend/src/lib/atrApi.ts): bis drei
  // Ziffern werden vorne mit Nullen aufgefüllt, alles andere bleibt.
  it("füllt vorne auf drei Stellen", () => {
    expect(formatPoPos("1")).toBe("001");
    expect(formatPoPos("15")).toBe("015");
    expect(formatPoPos("010")).toBe("010");
  });

  it("lässt anderes stehen", () => {
    expect(formatPoPos("1234")).toBe("1234");
    expect(formatPoPos("A1")).toBe("A1");
    expect(formatPoPos(null)).toBe("");
  });
});

describe("Seriennummern", () => {
  it("liest ein kommagetrenntes Feld", () => {
    expect(seriennummernAusText(" A1, A2 ,,A3 ")).toEqual(["A1", "A2", "A3"]);
    expect(seriennummernAusText("")).toEqual([]);
  });

  it("warnt, wenn die Anzahl nicht zur Menge passt", () => {
    expect(seriennummernAbweichung(["A1", "A2"], 2)).toBe(false);
    expect(seriennummernAbweichung(["A1"], 2)).toBe(true);
    // Wie im Altsystem: auch ohne jede Seriennummer ist das eine Abweichung.
    expect(seriennummernAbweichung([], 1)).toBe(true);
  });
});

describe("gewichtAusEingabe", () => {
  it("nimmt Komma und Punkt", () => {
    expect(gewichtAusEingabe("0,44")).toEqual({ wert: "0.44" });
    expect(gewichtAusEingabe(" 1.5 ")).toEqual({ wert: "1.5" });
  });

  it("leer heißt kein Gewicht", () => {
    expect(gewichtAusEingabe("  ")).toEqual({ wert: null });
  });

  it("weist Unsinn ab, statt ihn zu speichern", () => {
    expect(gewichtAusEingabe("ca. 0,4")).toEqual({ fehler: true });
    expect(gewichtAusEingabe("-1")).toEqual({ fehler: true });
  });
});

describe("intervallAusEingabe", () => {
  it("ganze Sekunden ab null", () => {
    expect(intervallAusEingabe("0")).toBe(0);
    expect(intervallAusEingabe(" 300 ")).toBe(300);
  });

  it("alles andere ist ungültig", () => {
    expect(intervallAusEingabe("")).toBeNull();
    expect(intervallAusEingabe("-5")).toBeNull();
    expect(intervallAusEingabe("1.5")).toBeNull();
    expect(intervallAusEingabe("zehn")).toBeNull();
  });
});

describe("ladeAlle", () => {
  it("holt seitenweise, bis nichts mehr kommt", async () => {
    const bestand = Array.from({ length: 2345 }, (_, i) => i);
    const abfrage = vi.fn(async (von: number, bis: number) => ({
      data: bestand.slice(von, bis + 1),
      error: null,
    }));
    const alle = await ladeAlle(abfrage);
    expect(alle).toEqual(bestand);
    expect(abfrage.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("wirft die Meldung der Datenbank", async () => {
    await expect(
      ladeAlle(async () => ({ data: null, error: { message: "kaputt" } })),
    ).rejects.toThrow("kaputt");
  });
});
