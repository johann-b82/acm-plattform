import { describe, expect, it } from "vitest";

import { GRUPPEN, sichtbareGruppen } from "@/lib/einstellungen";

describe("sichtbareGruppen", () => {
  it("zeigt nichts, wer nichts hat", () => {
    expect(sichtbareGruppen({})).toEqual([]);
  });

  it("zeigt je Recht nur die eigene Gruppe", () => {
    expect(sichtbareGruppen({ atr: "viewer" }).map((g) => g.id)).toEqual(["atr"]);
    expect(sichtbareGruppen({ kpi: "viewer" }).map((g) => g.id)).toEqual([
      "kennzahlen",
      "personal",
    ]);
  });

  it("zeigt der Plattform-Verwaltung alles", () => {
    expect(sichtbareGruppen({ platform: "admin" })).toHaveLength(GRUPPEN.length);
  });

  it("hält die Reihenfolge der Registrierung", () => {
    expect(sichtbareGruppen({ atr: "editor", kpi: "viewer" }).map((g) => g.id)).toEqual([
      "kennzahlen",
      "personal",
      "atr",
    ]);
  });

  it("verlangt für die Zugänge die Verwaltung, nicht nur ein Recht darauf", () => {
    // `platform` kennt nur `admin`; alles darunter darf keine Konten sehen.
    expect(sichtbareGruppen({ platform: "editor" }).map((g) => g.id)).toEqual([]);
    expect(sichtbareGruppen({ platform: "admin" }).map((g) => g.id)).toContain("zugaenge");
  });
});
