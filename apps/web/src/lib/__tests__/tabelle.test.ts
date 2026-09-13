/**
 * Die Tabellenregeln (TAB-01/02/03) als reine Funktionen.
 *
 * Reihenfolge ist Filter → Suche → Sortierung → Seite. Jeder Fall hier ist
 * einer, bei dem eine Tabelle sonst still Zeilen verliert, doppelt zeigt oder
 * ein Suchfeld wegnimmt, in dem noch Text steht.
 */
import { describe, expect, it } from "vitest";

import {
  SEITENGROESSEN,
  SUCHSCHWELLE,
  seitenfenster,
  sortiere,
  suche,
  suchfeldSichtbar,
  type Spalte,
} from "@/lib/tabelle";

interface Zeile {
  id: number;
  name: string | null;
  betrag: number | null;
  datum: string | null;
}

const SPALTEN: Spalte<Zeile>[] = [
  { schluessel: "name", typ: "text", wert: (z) => z.name },
  { schluessel: "betrag", typ: "zahl", wert: (z) => z.betrag },
  { schluessel: "datum", typ: "datum", wert: (z) => z.datum },
];

const zeilen: Zeile[] = [
  { id: 1, name: "Zander", betrag: 10, datum: "2026-03-01" },
  { id: 2, name: "ähre", betrag: -5, datum: "2025-12-31" },
  { id: 3, name: "Anton", betrag: 100, datum: null },
  { id: 4, name: null, betrag: 10, datum: "2026-01-15" },
  { id: 5, name: "anton", betrag: null, datum: "2026-01-15" },
];

const ids = (liste: Zeile[]) => liste.map((z) => z.id);

describe("Seitengrößen", () => {
  it("sind genau 25, 50 und 100", () => {
    expect(SEITENGROESSEN).toEqual([25, 50, 100]);
    expect(SUCHSCHWELLE).toBe(25);
  });
});

describe("sortiere", () => {
  it("sortiert Zahlen numerisch, nicht als Text", () => {
    const auf = sortiere(zeilen, SPALTEN[1], "auf");
    expect(ids(auf)).toEqual([2, 1, 4, 3, 5]);
  });

  it("stellt fehlende Werte in beiden Richtungen ans Ende", () => {
    expect(ids(sortiere(zeilen, SPALTEN[1], "ab"))).toEqual([3, 1, 4, 2, 5]);
    expect(ids(sortiere(zeilen, SPALTEN[2], "ab")).at(-1)).toBe(3);
  });

  it("ist stabil bei gleichen Werten — die Ausgangsreihenfolge bleibt", () => {
    // Betrag 10 bei id 1 und 4: in beiden Richtungen 1 vor 4.
    const ab = ids(sortiere(zeilen, SPALTEN[1], "ab"));
    expect(ab.indexOf(1)).toBeLessThan(ab.indexOf(4));
  });

  it("sortiert Datum chronologisch", () => {
    expect(ids(sortiere(zeilen, SPALTEN[2], "auf"))).toEqual([2, 4, 5, 1, 3]);
  });

  it("sortiert Text sprachgerecht und ohne Rücksicht auf Groß-/Kleinschreibung", () => {
    // „ähre" gehört im Deutschen zu „a", nicht hinter „z".
    const auf = ids(sortiere(zeilen, SPALTEN[0], "auf"));
    expect(auf.indexOf(2)).toBeLessThan(auf.indexOf(1));
    expect(auf.at(-1)).toBe(4);
  });

  it("verändert die Eingabe nicht", () => {
    const kopie = [...zeilen];
    sortiere(zeilen, SPALTEN[1], "ab");
    expect(zeilen).toEqual(kopie);
  });
});

describe("suche", () => {
  it("findet über alle durchsuchbaren Spalten, ohne Groß-/Kleinschreibung", () => {
    expect(ids(suche(zeilen, SPALTEN, "ANTON"))).toEqual([3, 5]);
  });

  it("findet formatierte Werte über eine eigene Suchdarstellung", () => {
    const mitText: Spalte<Zeile>[] = [
      { schluessel: "betrag", typ: "zahl", wert: (z) => z.betrag, suchtext: (z) => `${z.betrag} €` },
    ];
    expect(ids(suche(zeilen, mitText, "100 €"))).toEqual([3]);
  });

  it("gibt bei leerem Suchtext alles zurück", () => {
    expect(suche(zeilen, SPALTEN, "  ")).toHaveLength(5);
  });
});

describe("suchfeldSichtbar", () => {
  it("erscheint erst ab 26 Datensätzen", () => {
    expect(suchfeldSichtbar(25, "")).toBe(false);
    expect(suchfeldSichtbar(26, "")).toBe(true);
  });

  it("bleibt sichtbar, solange Suchtext steht — auch bei kleiner Menge", () => {
    expect(suchfeldSichtbar(3, "x")).toBe(true);
  });
});

describe("seitenfenster", () => {
  const liste = Array.from({ length: 101 }, (_, i) => i);

  it("schneidet Seiten ohne Lücke und ohne Doppelung", () => {
    const eins = seitenfenster(liste, 25, 1);
    const zwei = seitenfenster(liste, 25, 2);
    expect(eins.zeilen.at(-1)).toBe(24);
    expect(zwei.zeilen[0]).toBe(25);
    expect(eins.seiten).toBe(5);
  });

  it("zeigt die letzte Teilseite", () => {
    const letzte = seitenfenster(liste, 50, 3);
    expect(letzte.zeilen).toEqual([100]);
    expect(letzte.von).toBe(101);
    expect(letzte.bis).toBe(101);
  });

  it("zieht eine zu große Seitennummer auf die letzte gültige Seite", () => {
    expect(seitenfenster(liste, 100, 9).seite).toBe(2);
  });

  it("hat bei leerer Menge eine Seite und keine Zeilen", () => {
    const leer = seitenfenster([], 25, 4);
    expect(leer).toMatchObject({ seite: 1, seiten: 1, von: 0, bis: 0, zeilen: [] });
  });
});
