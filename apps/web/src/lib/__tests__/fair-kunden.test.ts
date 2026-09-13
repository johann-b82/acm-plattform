import { describe, expect, it } from "vitest";

import { kundenAuswahl, nachKunde, OHNE_KUNDE } from "@/lib/fair/kunden";

const Z = [
  { id: "1", kunde: "Pilatus" },
  { id: "2", kunde: null },
  { id: "3", kunde: "Diehl" },
  { id: "4", kunde: " Pilatus " },
  { id: "5", kunde: "" },
  { id: "6", kunde: "recaro" },
];

describe("Kundenfilter der Zeichnungsliste (FAI-01)", () => {
  it("bietet jeden Kunden einmal an, sprachgerecht sortiert", () => {
    expect(kundenAuswahl(Z)).toEqual({ kunden: ["Diehl", "Pilatus", "recaro"], ohneKunde: true });
  });

  it("bietet „ohne Kunde“ nur an, wenn es solche Zeichnungen gibt", () => {
    expect(kundenAuswahl([{ kunde: "Diehl" }]).ohneKunde).toBe(false);
  });

  it("leerer Filter lässt alles durch und behält die Menge", () => {
    expect(nachKunde(Z, "")).toBe(Z);
  });

  it("filtert auf einen Kunden, auch wenn er mit Leerzeichen gespeichert ist", () => {
    expect(nachKunde(Z, "Pilatus").map((z) => z.id)).toEqual(["1", "4"]);
  });

  it("filtert auf Zeichnungen ohne Kunde", () => {
    expect(nachKunde(Z, OHNE_KUNDE).map((z) => z.id)).toEqual(["2", "5"]);
  });
});
