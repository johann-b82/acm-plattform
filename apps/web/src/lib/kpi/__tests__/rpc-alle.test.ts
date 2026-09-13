/**
 * Listen, die eine Tabelle vollständig braucht, kommen seitenweise — ein
 * Zeilenmaximum von PostgREST darf sie nicht still abschneiden (TAB-01).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => (globalThis as { __sb?: unknown }).__sb,
}));

function clientMit(bestand: number[]) {
  const aufrufe: Array<[number, number]> = [];
  const rpc = vi.fn(() => ({
    range: async (von: number, bis: number) => {
      aufrufe.push([von, bis]);
      return { data: bestand.slice(von, bis + 1), error: null };
    },
  }));
  (globalThis as { __sb?: unknown }).__sb = { rpc };
  return { rpc, aufrufe };
}

describe("rpcAlle", () => {
  it("holt Seite um Seite, bis eine Seite nicht mehr voll ist", async () => {
    const { rpc, aufrufe } = clientMit(Array.from({ length: 2500 }, (_, i) => i));
    const { rpcAlle } = await import("../gemeinsam");
    const zeilen = await rpcAlle<number>("kpi_x", { von: null }, 1000);
    expect(zeilen).toHaveLength(2500);
    expect(zeilen[2499]).toBe(2499);
    expect(aufrufe).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(rpc).toHaveBeenCalledWith("kpi_x", { von: null });
  });

  it("fragt bei genau voller letzter Seite noch einmal und hört bei leer auf", async () => {
    const { aufrufe } = clientMit(Array.from({ length: 2000 }, (_, i) => i));
    const { rpcAlle } = await import("../gemeinsam");
    expect(await rpcAlle<number>("kpi_x", {}, 1000)).toHaveLength(2000);
    expect(aufrufe).toHaveLength(3);
  });

  it("wirft den Fehler der Datenbank weiter", async () => {
    (globalThis as { __sb?: unknown }).__sb = {
      rpc: () => ({ range: async () => ({ data: null, error: { message: "kaputt" } }) }),
    };
    const { rpcAlle } = await import("../gemeinsam");
    await expect(rpcAlle("kpi_x", {})).rejects.toThrow("kaputt");
  });
});
