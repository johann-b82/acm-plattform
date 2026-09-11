import { describe, expect, it } from "vitest";

import type { Uebersichtszeile } from "@/lib/kpi/bewertung";
import { badgeText, massnahmenStand } from "@/lib/kopfzeile";

function zeile(offen: number, ueberfaellig: number): Uebersichtszeile {
  return {
    schluessel: `k${offen}${ueberfaellig}`,
    bereich: "vertrieb",
    label: "Kennzahl",
    kommentare: 0,
    letzter_kommentar: null,
    offen,
    ueberfaellig,
    erledigt: 0,
  };
}

describe("badgeText", () => {
  it("zeigt kleine Zahlen wie sie sind", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
  });

  it("deckelt bei 99, damit der Punkt nicht aufreißt", () => {
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(4711)).toBe("99+");
  });
});

describe("massnahmenStand", () => {
  it("zählt über alle Kennzahlen", () => {
    expect(massnahmenStand([zeile(2, 1), zeile(3, 0), zeile(0, 0)])).toEqual({
      offen: 5,
      ueberfaellig: 1,
    });
  });

  it("zählt Überfällige nicht zu den Offenen dazu", () => {
    // Die Übersicht weist Überfällige als Teilmenge der Offenen aus; würden
    // sie addiert, stünde an der Glocke eine Zahl, die es nicht gibt.
    expect(massnahmenStand([zeile(1, 1)])).toEqual({ offen: 1, ueberfaellig: 1 });
  });

  it("kommt mit noch nicht geladenen Daten zurecht", () => {
    expect(massnahmenStand(undefined)).toEqual({ offen: 0, ueberfaellig: 0 });
    expect(massnahmenStand([])).toEqual({ offen: 0, ueberfaellig: 0 });
  });
});
