/**
 * Einkauf und Produktion: welche Menge die Tabellen bekommen und wie kurz die
 * Sätze unter den Kacheln sind.
 */
import { describe, expect, it, vi } from "vitest";

import { de } from "@/texte/de";

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => (globalThis as { __sb?: unknown }).__sb,
}));

function clientMit(data: unknown[]) {
  const rpc = vi.fn(() => ({ range: async () => ({ data, error: null }) }));
  (globalThis as { __sb?: unknown }).__sb = { rpc };
  return rpc;
}

describe("Einkauf: vollständige Mengen", () => {
  it("lädt Lieferpositionen ohne Grenze und mit Menge als Zahl", async () => {
    const rpc = clientMit([
      { auftrag: "A", pos: 1, upos: 0, quantity: "12.600", unit: "STK", adr_nr: "500" },
    ]);
    const { einkaufApi } = await import("../einkauf");
    const zeilen = await einkaufApi.positionen("2026-01-01", "2026-09-12");
    expect(rpc).toHaveBeenCalledWith("kpi_einkauf_positionen", { von: "2026-01-01", bis: "2026-09-12" });
    expect(zeilen[0].quantity).toBe(12.6);
  });

  it("lässt eine fehlende Menge fehlen statt 0", async () => {
    clientMit([{ auftrag: "A", pos: 1, upos: 0, quantity: null, unit: null, adr_nr: null }]);
    const { einkaufApi } = await import("../einkauf");
    expect((await einkaufApi.positionen(null, null))[0].quantity).toBeNull();
  });

  it("lädt alle Ladenhüter, nicht nur die ersten zwanzig", async () => {
    const rpc = clientMit([]);
    const { ladenhueterApi, LIEGETAGE } = await import("../einkauf");
    await ladenhueterApi.alle();
    expect(rpc).toHaveBeenCalledWith("kpi_einkauf_ladenhueter", { tage_ohne_bewegung: LIEGETAGE });
  });
});

describe("Produktion: zwei Auftragsmengen", () => {
  it("lädt die Liste ohne Grenze", async () => {
    const rpc = clientMit([]);
    const { produktionApi } = await import("../produktion");
    await produktionApi.liste(null, null);
    expect(rpc).toHaveBeenCalledWith("kpi_produktion_verzug_liste", { von: null, bis: null });
  });

  it("trennt zu spät gelieferte von überfälligen offenen Aufträgen", async () => {
    const { nachAnsicht } = await import("../produktion");
    const zeilen = [
      { vorgang_nr: "1", customer_name: null, adr_nr: null, ziel: "2026-01-01", ist: "2026-01-09", verzug_tage: 8, art: "verspaetet" as const },
      { vorgang_nr: "2", customer_name: null, adr_nr: null, ziel: "2026-01-01", ist: null, verzug_tage: 200, art: "offen" as const },
      { vorgang_nr: "3", customer_name: null, adr_nr: null, ziel: "2026-02-01", ist: null, verzug_tage: 150, art: "offen" as const },
    ];
    expect(nachAnsicht(zeilen, "verzug").map((z) => z.vorgang_nr)).toEqual(["1"]);
    expect(nachAnsicht(zeilen, "ueberfaellig").map((z) => z.vorgang_nr)).toEqual(["2", "3"]);
  });
});

describe("UI-01: Sätze unter den Kacheln passen in eine Zeile", () => {
  // Eine Kachel im Viererraster ist rund 250 px breit; in 12 px passen dort
  // etwa 40 Zeichen. Länger wird abgeschnitten — hier soll es gar nicht so weit kommen.
  const saetze = [
    de.einkauf.otdHinweis("98 %"),
    de.einkauf.verzugHinweis,
    de.produktion.quoteHinweis("20 %"),
    de.produktion.davonOffen("1.234"),
    de.produktion.gesamtHinweis,
    de.produktion.verzugHinweis,
  ];
  it.each(saetze)("„%s“", (satz) => {
    expect(satz.length).toBeLessThanOrEqual(40);
  });
});
