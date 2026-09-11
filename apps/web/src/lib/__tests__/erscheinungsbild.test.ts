/**
 * Hell, dunkel oder wie das System.
 *
 * Geprüft wird das, was beim Umschalten schiefgehen kann: eine ausdrückliche
 * helle Wahl unter einem dunklen Betriebssystem, ein gesperrter Speicher, und
 * dass „wie das System" das Attribut wirklich **entfernt** statt einen Wert zu
 * setzen — sonst folgte die Seite dem Betriebssystem nie wieder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SCHLUESSEL,
  anwenden,
  aufDemServer,
  gespeichert,
  merken,
} from "@/lib/erscheinungsbild";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Was gespeichert ist", () => {
  it("ohne Eintrag gilt die Vorgabe", () => {
    expect(gespeichert()).toBe("system");
  });

  it("liest eine getroffene Wahl", () => {
    window.localStorage.setItem(SCHLUESSEL, "dunkel");
    expect(gespeichert()).toBe("dunkel");
  });

  it("ignoriert Unsinn im Speicher", () => {
    window.localStorage.setItem(SCHLUESSEL, "lila");
    expect(gespeichert()).toBe("system");
  });

  it("überlebt einen gesperrten Speicher", () => {
    // Privates Fenster, gesperrte Website-Daten: der Zugriff wirft.
    const spion = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("gesperrt");
    });
    expect(gespeichert()).toBe("system");
    spion.mockRestore();
  });

  it("auf dem Server gilt immer die Vorgabe", () => {
    expect(aufDemServer()).toBe("system");
  });
});

describe("Anwenden", () => {
  it("dunkel setzt das Attribut", () => {
    anwenden("dunkel");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("hell setzt es ausdrücklich", () => {
    // Nicht weglassen: unter einem dunklen Betriebssystem bliebe es sonst dunkel.
    anwenden("hell");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("wie das System entfernt es", () => {
    anwenden("dunkel");
    anwenden("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("Merken", () => {
  it("schreibt eine Wahl", () => {
    merken("dunkel");
    expect(window.localStorage.getItem(SCHLUESSEL)).toBe("dunkel");
  });

  it("löscht den Eintrag bei „wie das System“", () => {
    // Ein gespeichertes „system" wäre dasselbe wie kein Eintrag — und ließe
    // sich nicht von einer alten Fassung unterscheiden.
    merken("hell");
    merken("system");
    expect(window.localStorage.getItem(SCHLUESSEL)).toBeNull();
  });
});
