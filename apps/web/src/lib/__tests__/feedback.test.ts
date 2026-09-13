import { describe, expect, it } from "vitest";

import { nachStatus, type Feedback } from "@/lib/feedback";

function meldung(id: string, status: Feedback["status"], gesehen: boolean): Feedback {
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
  };
}

describe("Kanban nach Status", () => {
  it("kennt genau die zwei Spalten offen und erledigt", () => {
    const spalten = nachStatus([meldung("a", "neu", true), meldung("b", "erledigt", false)]);
    expect(Object.keys(spalten)).toEqual(["neu", "erledigt"]);
  });

  it("sortiert nach Status, nicht nach gesehen", () => {
    const spalten = nachStatus([
      meldung("a", "neu", false),
      meldung("b", "erledigt", false),
      meldung("c", "neu", true),
    ]);
    expect(spalten.neu.map((m) => m.id)).toEqual(["a", "c"]);
    expect(spalten.erledigt.map((m) => m.id)).toEqual(["b"]);
  });
});
