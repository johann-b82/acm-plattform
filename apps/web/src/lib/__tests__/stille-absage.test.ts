import { describe, expect, it, vi } from "vitest";

/**
 * Eine von der Policy abgewiesene Aktualisierung sieht über PostgREST aus wie
 * eine erfolgreiche: Postgres meldet `UPDATE 0`, kein Fehler. Ohne `.select()`
 * hätte die Oberfläche „Gespeichert" gesagt, während nichts gespeichert wurde.
 *
 * In der Datenbank nachgestellt (Rolle `authenticated`, Claims ohne
 * `settings`-Recht):
 *
 *     UPDATE 0
 *     betroffene Zeilen: 0
 *
 * Hier wird nur geprüft, dass beide Schreibfunktionen daraus einen Fehler
 * machen.
 */

function clientMit(antwort: { data: unknown; error: unknown }) {
  const kette = {
    update: vi.fn(() => kette),
    eq: vi.fn(() => kette),
    select: vi.fn(async () => antwort),
  };
  return { from: vi.fn(() => kette), kette };
}

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => (globalThis as { __sb?: unknown }).__sb,
}));

async function mitAntwort(antwort: { data: unknown; error: unknown }) {
  const c = clientMit(antwort);
  (globalThis as { __sb?: unknown }).__sb = c;
  return c;
}

describe("Zielwert speichern", () => {
  it("wirft, wenn keine Zeile geändert wurde", async () => {
    await mitAntwort({ data: [], error: null });
    const { setzeZielwert } = await import("../zielwerte");
    await expect(setzeZielwert("einkauf_otd", 0.97)).rejects.toThrow(/Nicht gespeichert/);
  });

  it("ist still, wenn eine Zeile geändert wurde", async () => {
    await mitAntwort({ data: [{ schluessel: "einkauf_otd" }], error: null });
    const { setzeZielwert } = await import("../zielwerte");
    await expect(setzeZielwert("einkauf_otd", 0.97)).resolves.toBeUndefined();
  });

  it("reicht einen echten Fehler durch", async () => {
    await mitAntwort({ data: null, error: { message: "Verbindung weg" } });
    const { setzeZielwert } = await import("../zielwerte");
    await expect(setzeZielwert("einkauf_otd", 0.97)).rejects.toThrow("Verbindung weg");
  });
});

describe("Personal-Einstellung speichern", () => {
  it("wirft, wenn keine Zeile geändert wurde", async () => {
    await mitAntwort({ data: [], error: null });
    const { setzeHrEinstellung } = await import("../hr-einstellungen");
    await expect(setzeHrEinstellung("krank_typ_ids", ["568234"])).rejects.toThrow(
      /Nicht gespeichert/,
    );
  });

  it("ist still, wenn eine Zeile geändert wurde", async () => {
    await mitAntwort({ data: [{ schluessel: "krank_typ_ids" }], error: null });
    const { setzeHrEinstellung } = await import("../hr-einstellungen");
    await expect(setzeHrEinstellung("krank_typ_ids", ["568234"])).resolves.toBeUndefined();
  });
});

describe("Freitext zu Werten", () => {
  it("trennt an Komma und Zeilenumbruch und wirft Leeres weg", async () => {
    const { ausFreitext, alsFreitext } = await import("../hr-einstellungen");
    expect(ausFreitext(" 568234 , 3270500 ,, \n 999 ")).toEqual(["568234", "3270500", "999"]);
    expect(ausFreitext("")).toEqual([]);
    expect(alsFreitext(["a", "b"])).toBe("a, b");
  });
});
