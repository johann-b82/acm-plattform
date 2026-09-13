/**
 * HR: die Mitarbeiterauswahl (HR-07) und die Personenlisten der
 * Wochenberichtsdiagramme (HR-05).
 *
 * Die Auswahl wirkt vor Suche, Sortierung und Seiten — sie bestimmt die
 * fachliche Menge, die die Tabelle bekommt. Die Definitionen stammen aus dem
 * Altsystem (`EmployeeTable.tsx`): Überstunden heißt mehr als null, aktiv
 * heißt Personio-Status `active`.
 */
import { describe, expect, it } from "vitest";

import {
  spitze,
  waehleMitarbeiter,
  type MitarbeiterZeile,
  type WochenZeile,
} from "@/lib/kpi/personal";

function ma(id: number, extra: Partial<MitarbeiterZeile> = {}): MitarbeiterZeile {
  return {
    employee_id: id,
    name: `P${id}`,
    department: null,
    position: null,
    status: "active",
    wochenstunden: 40,
    ist_stunden: 0,
    ueberstunden: 0,
    quote: null,
    ...extra,
  };
}

function woche(id: number, extra: Partial<WochenZeile> = {}): WochenZeile {
  return {
    employee_id: id,
    name: `P${id}`,
    ist_stunden: 40,
    soll_stunden: 40,
    netto: 0,
    krank_tage: 0,
    krank_stunden: 0,
    ...extra,
  };
}

describe("Mitarbeiterauswahl", () => {
  const zeilen = [
    ma(1, { ueberstunden: 2.5 }),
    ma(2, { status: "inactive", ueberstunden: 1 }),
    ma(3),
    ma(4, { status: "onboarding" }),
  ];
  const ids = (z: MitarbeiterZeile[]) => z.map((x) => x.employee_id);

  it("mit Überstunden: nur wer mehr als null hat — auch Ausgetretene", () => {
    expect(ids(waehleMitarbeiter(zeilen, "ueberstunden"))).toEqual([1, 2]);
  });

  it("aktive: Personio-Status active, nicht Onboarding", () => {
    expect(ids(waehleMitarbeiter(zeilen, "aktive"))).toEqual([1, 3]);
  });

  it("alle: nichts fällt weg", () => {
    expect(ids(waehleMitarbeiter(zeilen, "alle"))).toEqual([1, 2, 3, 4]);
  });

  it("eine leere Auswahl bleibt leer, statt auf alle zurückzufallen", () => {
    expect(waehleMitarbeiter([ma(1)], "ueberstunden")).toEqual([]);
  });
});

describe("Personen in den Wochenberichtsdiagrammen", () => {
  it("nimmt nur Werte über null, größte zuerst", () => {
    const liste = spitze(
      [woche(1, { netto: 1 }), woche(2, { netto: -3 }), woche(3, { netto: 4 }), woche(4, { netto: 0.005 })],
      (z) => z.netto,
    );
    expect(liste).toEqual([
      { name: "P3", wert: 4 },
      { name: "P1", wert: 1 },
    ]);
  });

  it("zeigt höchstens fünf, wie das Altsystem", () => {
    const zeilen = Array.from({ length: 8 }, (_, i) => woche(i + 1, { krank_stunden: i + 1 }));
    const liste = spitze(zeilen, (z) => z.krank_stunden);
    expect(liste.map((p) => p.wert)).toEqual([8, 7, 6, 5, 4]);
  });

  it("benennt Personen ohne Namen mit ihrer Kennung", () => {
    expect(spitze([woche(9, { name: null, netto: 2 })], (z) => z.netto)).toEqual([{ name: "#9", wert: 2 }]);
  });
});
