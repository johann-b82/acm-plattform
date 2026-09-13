import { describe, expect, it } from "vitest";

import {
  BEREICH_PFAD,
  aufgezogen,
  bereichFuerPfad,
  bubblesDesBereichs,
  filtereMassnahmen,
  prioritaetRang,
  type Bubble,
  type Massnahme,
} from "@/lib/kpi/bewertung";

function massnahme(status: Massnahme["status"], titel = status): Massnahme {
  return {
    id: titel,
    schluessel: "einkauf_otd",
    titel,
    beschreibung: null,
    zustaendig: null,
    faellig_am: null,
    status,
    prioritaet: "mittel",
    kommentar_id: null,
    erledigt_am: null,
    erstellt_am: "2026-09-01T00:00:00Z",
    geaendert_am: "2026-09-01T00:00:00Z",
  };
}

function bubble(bereich: string, nummer: number): Bubble {
  return {
    id: `${bereich}${nummer}`,
    schluessel: null,
    bereich,
    nummer,
    text: "T",
    ampel: null,
    pos_x: null,
    pos_y: null,
    breite: null,
    hoehe: null,
    verfasser_email: null,
    gesehen_am: null,
    erstellt_am: "2026-09-01T00:00:00Z",
  };
}

describe("Statusfilter", () => {
  const liste = [massnahme("offen"), massnahme("laeuft"), massnahme("erledigt"), massnahme("verworfen")];

  it("„Alle Status“ lässt alles durch", () => {
    expect(filtereMassnahmen(liste, "alle")).toHaveLength(4);
  });

  it("„in Arbeit“ ist der gespeicherte Wert `laeuft`", () => {
    expect(filtereMassnahmen(liste, "laeuft").map((m) => m.status)).toEqual(["laeuft"]);
  });
});

describe("Priorität", () => {
  it("sortiert fachlich, nicht nach dem Wort", () => {
    expect(prioritaetRang("niedrig")).toBeLessThan(prioritaetRang("mittel"));
    expect(prioritaetRang("mittel")).toBeLessThan(prioritaetRang("hoch"));
  });
});

describe("Bereiche und Seiten", () => {
  it("jeder Bereich hat seine Dashboard-Seite, HR liegt unter /hr", () => {
    expect(BEREICH_PFAD.personal).toBe("/hr/kennzahlen");
    expect(BEREICH_PFAD.einkauf).toBe("/kpi/einkauf");
  });

  it("findet den Bereich zur Seite und nichts auf anderen Seiten", () => {
    expect(bereichFuerPfad("/kpi/qualitaet")).toBe("qualitaet");
    expect(bereichFuerPfad("/hr/kennzahlen")).toBe("personal");
    expect(bereichFuerPfad("/kpi/bewertung")).toBeNull();
    expect(bereichFuerPfad("/kpi")).toBeNull();
  });

  it("die Bubble-Auswahl im Formular zeigt die Bubbles des Bereichs der Kennzahl", () => {
    const alle = [bubble("einkauf", 2), bubble("vertrieb", 1), bubble("einkauf", 1)];
    expect(bubblesDesBereichs(alle, "einkauf").map((b) => b.nummer)).toEqual([1, 2]);
    expect(bubblesDesBereichs(alle, null)).toEqual([]);
  });
});

describe("Aufgezogenes Rechteck", () => {
  it("normiert die Richtung", () => {
    expect(aufgezogen({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({
      x: 0.2,
      y: 0.1,
      w: 0.3,
      h: 0.5,
    });
  });

  it("verwirft einen bloßen Klick", () => {
    expect(aufgezogen({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.6 })).toBeNull();
  });
});
