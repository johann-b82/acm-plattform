import { describe, expect, it } from "vitest";

import { gehoertZurSeite, nachPerson, nachStatus, type Feedback } from "@/lib/feedback";

describe("Feedback zur Seite", () => {
  it("nimmt den Pfad selbst, auch mit Suchteil", () => {
    expect(gehoertZurSeite("/kpi/vertrieb", "/kpi/vertrieb")).toBe(true);
    expect(gehoertZurSeite("/kpi/vertrieb?jahr=2026", "/kpi/vertrieb")).toBe(true);
  });

  it("nimmt keine Unterseite und keinen ähnlichen Pfad", () => {
    expect(gehoertZurSeite("/kpi/vertrieb", "/kpi")).toBe(false);
    expect(gehoertZurSeite("/kpi/vertrieb2", "/kpi/vertrieb")).toBe(false);
    expect(gehoertZurSeite("/kpi_x", "/kpi")).toBe(false);
  });
});

function meldung(
  id: string,
  status: Feedback["status"],
  gesehen: boolean,
  zugewiesen: string | null = null,
): Feedback {
  return {
    id,
    seite: "/kpi",
    beschreibung: "B",
    bild_pfad: null,
    browser: null,
    ansicht: null,
    status,
    gesehen_am: gesehen ? "2026-09-01T00:00:00Z" : null,
    erstellt_am: "2026-09-01T00:00:00Z",
    melder_email: null,
    zugewiesen,
    version: 1,
  };
}

describe("Kanban nach Status", () => {
  it("kennt genau die drei Spalten offen, in Bearbeitung und erledigt", () => {
    const spalten = nachStatus([meldung("a", "neu", true), meldung("b", "erledigt", false)]);
    expect(Object.keys(spalten)).toEqual(["neu", "in_bearbeitung", "erledigt"]);
  });

  it("sortiert nach Status, nicht nach gesehen", () => {
    const spalten = nachStatus([
      meldung("a", "neu", false),
      meldung("b", "erledigt", false),
      meldung("c", "neu", true),
      meldung("d", "in_bearbeitung", true),
    ]);
    expect(spalten.neu.map((m) => m.id)).toEqual(["a", "c"]);
    expect(spalten.in_bearbeitung.map((m) => m.id)).toEqual(["d"]);
    expect(spalten.erledigt.map((m) => m.id)).toEqual(["b"]);
  });
});

describe("Kanban nach Person", () => {
  const konten = [
    { id: "u2", email: "zoe@example.com" },
    { id: "u1", email: "anna@example.com" },
  ];

  it("hat eine Spalte je Konto, nach E-Mail sortiert, und vorn „nicht zugewiesen“", () => {
    const spalten = nachPerson([meldung("a", "neu", true)], konten);
    expect(spalten.map((s) => s.zugewiesen)).toEqual([null, "u1", "u2"]);
  });

  it("legt jede Meldung in die Spalte ihrer Person", () => {
    const spalten = nachPerson(
      [meldung("a", "neu", true, "u2"), meldung("b", "neu", true), meldung("c", "erledigt", true, "u2")],
      konten,
    );
    const von = (z: string | null) => spalten.find((s) => s.zugewiesen === z)!.meldungen.map((m) => m.id);
    expect(von(null)).toEqual(["b"]);
    expect(von("u1")).toEqual([]);
    expect(von("u2")).toEqual(["a", "c"]);
  });

  it("verliert keine Meldung, deren Konto nicht mehr in der Liste steht", () => {
    const spalten = nachPerson([meldung("a", "neu", true, "weg")], konten);
    expect(spalten.find((s) => s.zugewiesen === null)!.meldungen.map((m) => m.id)).toEqual(["a"]);
  });
});
