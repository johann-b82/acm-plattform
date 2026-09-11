import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ELTERN, TITEL, krumen } from "@/lib/brotkrumen";

const TAFEL: Record<string, string> = TITEL;

describe("krumen", () => {
  it("bleibt auf der Übersicht leer", () => {
    expect(krumen("/")).toEqual([]);
  });

  it("schweigt zu Adressen, die es nicht kennt", () => {
    expect(krumen("/gibtesnicht")).toEqual([]);
    expect(krumen("/login")).toEqual([]);
  });

  it("stellt „Start“ voran", () => {
    expect(krumen("/uploads")).toEqual([
      { titel: "Start", adresse: "/" },
      { titel: "Uploads", adresse: "/uploads" },
    ]);
  });

  it("baut die Kette aus den Vorsilben", () => {
    expect(krumen("/hr/schulungen/matrix").map((k) => k.titel)).toEqual([
      "Start",
      "Personal",
      "Schulungen",
      "Matrix",
    ]);
  });

  it("lässt eine Detailseite bei ihrer Liste enden", () => {
    // Die 7 ist keine Überschrift: der Name des Datensatzes steht auf der
    // Seite, nicht in der Adresse.
    expect(krumen("/hr/schulungen/7")).toEqual(krumen("/hr/schulungen"));
    expect(krumen("/atr/lieferungen/abc-123").map((k) => k.titel)).toEqual([
      "Start",
      "ATR",
      "Lieferungen",
    ]);
  });

  it("hängt eine Seite dorthin, wo ELTERN es sagt", () => {
    // /platform leitet auf die Einstellungen um; die Meldungen hängen dort.
    expect(krumen("/platform/feedback").map((k) => k.adresse)).toEqual([
      "/",
      "/einstellungen",
      "/platform/feedback",
    ]);
  });

  it("überspringt eine Ebene ohne Titel", () => {
    // /platform selbst hat keinen Titel — ohne ELTERN fiele es aus der Kette,
    // statt eine leere Krume zu erzeugen.
    expect(krumen("/platform/feedback").every((k) => k.titel.length > 0)).toBe(true);
  });

  it("endet auch bei einem Kreis in ELTERN", () => {
    const sicherung = { ...ELTERN };
    Object.assign(ELTERN, { "/hr": "/uploads", "/uploads": "/hr" });
    try {
      expect(krumen("/hr").length).toBeLessThan(5);
    } finally {
      for (const k of Object.keys(ELTERN)) delete ELTERN[k];
      Object.assign(ELTERN, sicherung);
    }
  });

  it("verweist auf jede Ebene über sich", () => {
    const kette = krumen("/signage/playlists");
    expect(kette.map((k) => k.adresse)).toEqual(["/", "/signage", "/signage/playlists"]);
  });
});

/**
 * Der Grund, warum die Ketten nicht ausgeschrieben dastehen: im Altsystem tat
 * eine Tabelle das, und mehrere Seiten fehlten darin, ohne dass es auffiel.
 * Hier fällt es auf.
 */
describe("Vollständigkeit", () => {
  const wurzel = path.resolve(__dirname, "../../app/(app)");

  function seiten(ordner: string, vorsilbe = ""): string[] {
    const gefunden: string[] = [];
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      if (eintrag.isFile() && eintrag.name === "page.tsx" && vorsilbe) gefunden.push(vorsilbe);
      if (!eintrag.isDirectory()) continue;
      gefunden.push(...seiten(path.join(ordner, eintrag.name), `${vorsilbe}/${eintrag.name}`));
    }
    return gefunden;
  }

  const alle = seiten(wurzel);
  // Adressen mit [Platzhalter] sind Detailseiten; sie enden bewusst bei ihrer
  // Liste. /platform leitet um und wird nie angezeigt.
  const feste = alle.filter((p) => !p.includes("[") && p !== "/platform");

  it("findet die Seiten überhaupt", () => {
    expect(feste.length).toBeGreaterThan(20);
  });

  it.each(feste)("kennt %s", (adresse) => {
    expect(TAFEL[adresse]).toBeTruthy();
  });

  it("kennt keine Seite, die es nicht gibt", () => {
    expect(Object.keys(TITEL).filter((p) => !alle.includes(p))).toEqual([]);
  });
});
