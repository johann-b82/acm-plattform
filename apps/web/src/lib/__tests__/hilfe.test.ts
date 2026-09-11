/**
 * Die Hilfe in der Anwendung.
 *
 * Geprüft wird, was beim Schreiben schiefgehen kann und niemandem auffällt:
 * ein doppelter Verweis, eine Seite ohne Text, ein Link ins Leere.
 */
import { describe, expect, it } from "vitest";

import { ALLE, GRUPPEN, finde, suche } from "@/hilfe/registry";

describe("Aufbau", () => {
  it("hat die fünf Gruppen des Altprojekts", () => {
    expect(GRUPPEN.map((g) => g.id)).toEqual([
      "einstieg",
      "kennzahlen",
      "arbeiten",
      "fach",
      "verwaltung",
    ]);
  });

  it("kein Verweis kommt zweimal vor", () => {
    // Zwei Seiten mit demselben Verweis: eine wäre nie erreichbar.
    const verweise = ALLE.map((s) => s.slug);
    expect(new Set(verweise).size).toBe(verweise.length);
  });

  it("jede Seite hat Titel, Kurztext und Inhalt", () => {
    for (const seite of ALLE) {
      expect(seite.titel.length, seite.slug).toBeGreaterThan(2);
      expect(seite.kurz.length, seite.slug).toBeGreaterThan(10);
      expect(seite.text.length, seite.slug).toBeGreaterThan(200);
    }
  });

  it("jede Seite beginnt mit einer Überschrift erster Ordnung", () => {
    for (const seite of ALLE) {
      expect(seite.text.startsWith("# "), seite.slug).toBe(true);
    }
  });

  it("der Verweis passt zu keinem Pfad mit Sonderzeichen", () => {
    for (const seite of ALLE) {
      expect(seite.slug, seite.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("Finden", () => {
  it("findet eine Seite samt ihrer Gruppe", () => {
    const treffer = finde("dokumentenlauf");
    expect(treffer?.seite.titel).toBe("Dokumentenlauf");
    expect(treffer?.gruppe.id).toBe("arbeiten");
  });

  it("gibt bei einem unbekannten Verweis nichts zurück", () => {
    expect(finde("gibt-es-nicht")).toBeNull();
  });
});

describe("Suche", () => {
  it("sucht auch im Fließtext, nicht nur im Titel", () => {
    // „Ladenhüter" steht im Text der Einkaufsseite, nicht in ihrem Titel.
    const treffer = suche("Ladenhüter");
    expect(treffer.map((t) => t.seite.slug)).toContain("einkauf");
  });

  it("achtet nicht auf Groß- und Kleinschreibung", () => {
    expect(suche("PERSONIO").length).toBeGreaterThan(0);
  });

  it("sucht erst ab zwei Zeichen", () => {
    // Sonst käme bei jedem Tastendruck die halbe Hilfe zurück.
    expect(suche("a")).toEqual([]);
    expect(suche(" ")).toEqual([]);
  });
});
