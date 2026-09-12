/**
 * Die Prüftabelle „Materialverbrauch je Artikel" kommt vollständig — auch
 * über das PostgREST-Maximum von 1000 Zeilen hinaus (TAB-01: keine stille
 * Abschneidegrenze). Über „Alles" sind es mehr als 2400 Artikel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const aufrufe: { name: string; args: Record<string, unknown>; von: number; bis: number }[] = [];
let bestand: { artikelnr: string }[] = [];

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    rpc: (name: string, args: Record<string, unknown>) => ({
      range: async (von: number, bis: number) => {
        aufrufe.push({ name, args, von, bis });
        return { data: bestand.slice(von, bis + 1), error: null };
      },
    }),
  }),
}));

import { finanzenApi } from "@/lib/kpi/finanzen";

function artikel(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    artikelnr: `A-${i}`,
    article_name: null,
    menge: "1",
    stueckpreis: null,
    kosten: null,
  }));
}

describe("finanzenApi.verbrauch", () => {
  beforeEach(() => {
    aufrufe.length = 0;
  });

  it("lädt seitenweise, bis eine Seite nicht mehr voll ist", async () => {
    bestand = artikel(2437);
    const zeilen = await finanzenApi.verbrauch(null, null);
    expect(zeilen).toHaveLength(2437);
    expect(aufrufe.map((a) => [a.von, a.bis])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(new Set(zeilen.map((z) => z.artikelnr)).size).toBe(2437);
  });

  it("fragt bei genau 1000 Zeilen noch einmal nach und hört bei der leeren Seite auf", async () => {
    bestand = artikel(1000);
    expect(await finanzenApi.verbrauch("2026-01-01", "2026-09-12")).toHaveLength(1000);
    expect(aufrufe).toHaveLength(2);
  });

  it("schickt keine Zeilengrenze mehr mit", async () => {
    bestand = artikel(3);
    await finanzenApi.verbrauch("2026-01-01", "2026-09-12");
    expect(aufrufe[0].name).toBe("kpi_finanzen_materialverbrauch");
    expect(aufrufe[0].args).toEqual({ von: "2026-01-01", bis: "2026-09-12" });
  });
});
