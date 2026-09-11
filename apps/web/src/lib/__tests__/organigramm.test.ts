/**
 * Das Organigramm.
 *
 * Geprüft wird der Baumbau — und zwar an den Fällen, die gepflegte Daten
 * wirklich hergeben: jemand als sein eigener Vorgesetzter, ein Kreis, ein
 * Verweis auf eine ausgetretene Person. Jeder davon lässt eine naive
 * Rekursion entweder endlos laufen oder einen ganzen Ast verschwinden.
 */
import { describe, expect, it } from "vitest";

import { baueWald, filtere, standorte, type Person } from "@/lib/organigramm";

function person(id: number, name: string, chef: number | null, extra: Partial<Person> = {}): Person {
  return {
    id,
    name,
    position: null,
    department: null,
    standort: null,
    vorgesetzter_id: chef,
    ...extra,
  };
}

const HAUS = [
  person(1, "Chefin", null),
  person(2, "Leitung Fertigung", 1),
  person(3, "Leitung Montage", 1),
  person(4, "Näherin", 2),
  person(5, "Monteur", 3),
];

function namen(knoten: { name: string | null; kinder: unknown[] }[]): string[] {
  return knoten.map((k) => k.name!);
}

describe("Wald bauen", () => {
  it("hängt jeden unter seinen Vorgesetzten", () => {
    const wald = baueWald(HAUS);
    expect(namen(wald)).toEqual(["Chefin"]);
    expect(namen(wald[0].kinder)).toEqual(["Leitung Fertigung", "Leitung Montage"]);
    expect(namen(wald[0].kinder[0].kinder)).toEqual(["Näherin"]);
  });

  it("sortiert die Geschwister nach Namen", () => {
    const wald = baueWald([
      person(1, "Chefin", null),
      person(2, "Zacharias", 1),
      person(3, "Ärmel", 1),
      person(4, "Meier", 1),
    ]);
    // Deutsche Sortierung: Ä vor M vor Z.
    expect(namen(wald[0].kinder)).toEqual(["Ärmel", "Meier", "Zacharias"]);
  });

  it("macht zur Wurzel, wessen Vorgesetzter fehlt", () => {
    // Die Sicht führt nur Aktive. Ist der Chef ausgetreten, verschwände der
    // ganze Ast, wenn man den Fall nicht abfinge.
    const wald = baueWald([person(4, "Näherin", 99)]);
    expect(namen(wald)).toEqual(["Näherin"]);
  });

  it("verkraftet jemanden als seinen eigenen Vorgesetzten", () => {
    // Bei der Geschäftsführung ein Klassiker.
    const wald = baueWald([person(1, "Chefin", 1)]);
    expect(namen(wald)).toEqual(["Chefin"]);
    expect(wald[0].kinder).toEqual([]);
  });

  it("verkraftet einen Kreis", () => {
    // A berichtet an B, B an A. Wer zur Wurzel wird, ist willkürlich —
    // wichtig ist, dass niemand verschwindet und nichts endlos läuft.
    const wald = baueWald([person(1, "A", 2), person(2, "B", 1)]);
    const alle: string[] = [];
    const lauf = (k: { name: string | null; kinder: { name: string | null; kinder: unknown[] }[] }[]) => {
      for (const x of k) {
        alle.push(x.name!);
        lauf(x.kinder as never);
      }
    };
    lauf(wald);
    expect(alle.sort()).toEqual(["A", "B"]);
  });

  it("lässt niemanden verschwinden", () => {
    const wald = baueWald(HAUS);
    let gezaehlt = 0;
    const lauf = (k: { kinder: unknown[] }[]) => {
      for (const x of k) {
        gezaehlt += 1;
        lauf(x.kinder as never);
      }
    };
    lauf(wald);
    expect(gezaehlt).toBe(HAUS.length);
  });

  it("kommt mit einer leeren Liste zurecht", () => {
    expect(baueWald([])).toEqual([]);
  });
});

describe("Standorte", () => {
  it("sammelt sie ohne Dopplungen und ohne Leeres", () => {
    const liste = [
      person(1, "A", null, { standort: "Bad Neustadt" }),
      person(2, "B", null, { standort: "Bad Neustadt" }),
      person(3, "C", null, { standort: null }),
      person(4, "D", null, { standort: "Hamburg" }),
    ];
    expect(standorte(liste)).toEqual(["Bad Neustadt", "Hamburg"]);
  });
});

describe("Filtern", () => {
  it("behält die Vorgesetztenkette eines Treffers", () => {
    // „Näherin" allein sagt nicht, wo sie im Haus sitzt.
    const uebrig = filtere(HAUS, "Näherin", null).map((p) => p.name);
    expect(uebrig.sort()).toEqual(["Chefin", "Leitung Fertigung", "Näherin"]);
  });

  it("sucht auch in Position und Abteilung", () => {
    const liste = [person(1, "Meier", null, { position: "Schweißer", department: "Fertigung" })];
    expect(filtere(liste, "schweiß", null)).toHaveLength(1);
    expect(filtere(liste, "fertigung", null)).toHaveLength(1);
  });

  it("filtert nach Standort", () => {
    const liste = [
      person(1, "A", null, { standort: "Hamburg" }),
      person(2, "B", null, { standort: "Bad Neustadt" }),
    ];
    expect(filtere(liste, "", "Hamburg").map((p) => p.name)).toEqual(["A"]);
  });

  it("gibt ohne Filter alles zurück", () => {
    expect(filtere(HAUS, "  ", null)).toHaveLength(HAUS.length);
  });

  it("läuft sich an einem Kreis nicht fest", () => {
    const kreis = [person(1, "A", 2), person(2, "B", 1)];
    expect(filtere(kreis, "A", null).map((p) => p.name).sort()).toEqual(["A", "B"]);
  });
});
