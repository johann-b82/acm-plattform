/**
 * Das Organigramm mit Standortfokus (ORG-01).
 *
 * Wer zum gewählten Standort gehört, ist ein Treffer und wird umrandet. Seine
 * Vorgesetztenkette bleibt stehen, auch wenn sie woanders sitzt — dezent, als
 * Kontext. Niemand kommt allein wegen des Kontexts dazu.
 */
import { describe, expect, it } from "vitest";

import { baueWald, filtere, treffer, type Person } from "@/lib/organigramm";

function person(id: number, name: string, chef: number | null, standort: string | null, extra: Partial<Person> = {}): Person {
  return {
    id,
    name,
    position: null,
    department: null,
    standort,
    vorgesetzter_id: chef,
    hat_foto: false,
    ...extra,
  };
}

const HAUS = [
  person(1, "Geschäftsführung", null, "Memmingen"),
  person(2, "Leitung Hamburg", 1, "Hamburg"),
  person(3, "Leitung Memmingen", 1, "Memmingen"),
  person(4, "Monteurin", 2, "Hamburg"),
  person(5, "Prüfer", 3, "Memmingen"),
  person(6, "Remote-Kraft", 3, "Remote"),
];

describe("Treffer", () => {
  it("ohne Filter gibt es keinen Fokus", () => {
    expect(treffer(HAUS, "", null)).toBeNull();
    expect(treffer(HAUS, "   ", null)).toBeNull();
  });

  it("markiert die Personen des Standorts, nicht ihre Vorgesetzten von anderswo", () => {
    expect([...treffer(HAUS, "", "Hamburg")!].sort()).toEqual([2, 4]);
    // Die Geschäftsführung in Memmingen bleibt als Kette stehen …
    expect(filtere(HAUS, "", "Hamburg").map((p) => p.id).sort()).toEqual([1, 2, 4]);
  });

  it("bleibt bei jedem Standort aus den Daten richtig, nicht nur bei Hamburg", () => {
    expect([...treffer(HAUS, "", "Remote")!]).toEqual([6]);
    expect(filtere(HAUS, "", "Remote").map((p) => p.id).sort()).toEqual([1, 3, 6]);
  });

  it("verbindet Suche und Standort", () => {
    expect([...treffer(HAUS, "leitung", "Memmingen")!]).toEqual([3]);
  });

  it("die Kette hängt im Baum an ihren Vorgesetzten", () => {
    const wald = baueWald(filtere(HAUS, "", "Hamburg"));
    expect(wald.map((k) => k.id)).toEqual([1]);
    expect(wald[0].kinder.map((k) => k.id)).toEqual([2]);
    expect(wald[0].kinder[0].kinder.map((k) => k.id)).toEqual([4]);
  });
});
