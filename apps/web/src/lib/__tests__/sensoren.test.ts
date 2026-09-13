import { describe, expect, it } from "vitest";

import {
  FENSTER,
  alleSeiten,
  ausserhalb,
  einstellungenAusEntwurf,
  einstellungsFehler,
  farbeVon,
  zustand,
  type Sensor,
  type Stand,
} from "@/lib/sensoren";

const sensor = (teil: Partial<Sensor> = {}): Sensor => ({
  id: "s1",
  name: "Serverraum",
  rechner: "sensor.acm.local",
  port: 161,
  temperatur_oid: "1.1",
  feuchte_oid: null,
  temperatur_faktor: "1",
  feuchte_faktor: "1",
  aktiv: true,
  farbe: null,
  ...teil,
});

const stand = (gemessen_am: string | null): Stand => ({
  sensor_id: "s1",
  gemessen_am,
  temperatur: "21.0",
  feuchte: null,
  versucht_am: gemessen_am,
  erfolg: true,
  fehler: null,
});

describe("ausserhalb", () => {
  it("kennt keine Grenze, wenn keine gesetzt ist", () => {
    expect(ausserhalb(99, null, null)).toBe(false);
  });

  it("warnt unter der Untergrenze und über der Obergrenze", () => {
    expect(ausserhalb(17.9, "18", "24")).toBe(true);
    expect(ausserhalb(24.1, "18", "24")).toBe(true);
  });

  it("lässt die Grenze selbst noch durch", () => {
    expect(ausserhalb(18, "18", "24")).toBe(false);
    expect(ausserhalb(24, "18", "24")).toBe(false);
  });

  it("warnt nicht über einen fehlenden Wert", () => {
    expect(ausserhalb(null, "18", "24")).toBe(false);
  });
});

describe("zustand", () => {
  const jetzt = new Date("2026-09-10T12:00:00Z").getTime();
  const vor = (minuten: number) =>
    new Date(jetzt - minuten * 60_000).toISOString();

  it("nennt ein Gerät ohne Messwert unbekannt", () => {
    expect(zustand(stand(null), 300, jetzt)).toBe("unbekannt");
    expect(zustand(undefined, 300, jetzt)).toBe("unbekannt");
  });

  it("hält bei fünf Minuten Takt einen ausgelassenen Takt noch für frisch", () => {
    expect(zustand(stand(vor(4)), 300, jetzt)).toBe("frisch");
    expect(zustand(stand(vor(10)), 300, jetzt)).toBe("frisch");
  });

  it("meldet ab dem dritten ausgelassenen Takt Verzögerung", () => {
    expect(zustand(stand(vor(15)), 300, jetzt)).toBe("verzoegert");
  });

  it("nennt es offline nach vier ausgelassenen Takten", () => {
    expect(zustand(stand(vor(45)), 300, jetzt)).toBe("offline");
  });

  it("richtet sich nach dem eingestellten Takt, nicht nach fünf Minuten", () => {
    // SET-10: bei einer Stunde ist eine Messung von vor 90 Minuten normal.
    expect(zustand(stand(vor(90)), 3600, jetzt)).toBe("frisch");
    expect(zustand(stand(vor(180)), 3600, jetzt)).toBe("verzoegert");
    expect(zustand(stand(vor(300)), 3600, jetzt)).toBe("offline");
  });
});

describe("farbeVon", () => {
  it("nimmt die eigene Farbe, wenn eine gesetzt ist", () => {
    expect(farbeVon(sensor({ farbe: "#123456" }), 3)).toBe("#123456");
  });

  it("greift sonst reihum in die Palette", () => {
    expect(farbeVon(sensor(), 0)).toBe(farbeVon(sensor(), 5));
  });
});

describe("FENSTER", () => {
  it("bietet 1 h bis 30 Tage an, die bisherigen Fenster bleiben", () => {
    // SEN-03/SEN-04
    expect(FENSTER).toEqual([1, 6, 24, 72, 168, 720]);
  });
});

describe("ausserhalb mit Zahlen", () => {
  it("nimmt die globalen Grenzen als Zahl", () => {
    expect(ausserhalb(15.9, 16, 30)).toBe(true);
    expect(ausserhalb(16, 16, 30)).toBe(false);
    expect(ausserhalb(71, null, 70)).toBe(true);
  });
});

const entwurf = (teil: Partial<Record<string, string>> = {}) => ({
  abfrage_sekunden: "3600",
  temperatur_min: "16",
  temperatur_max: "30",
  feuchte_min: "30",
  feuchte_max: "70",
  ...teil,
});

describe("einstellungsFehler", () => {
  it("lässt die Referenzwerte durch", () => {
    expect(einstellungsFehler(entwurf())).toEqual([]);
  });

  it("hält den Takt zwischen 5 und 86400 Sekunden, ganzzahlig", () => {
    expect(einstellungsFehler(entwurf({ abfrage_sekunden: "4" }))).toEqual(["intervall"]);
    expect(einstellungsFehler(entwurf({ abfrage_sekunden: "86401" }))).toEqual(["intervall"]);
    expect(einstellungsFehler(entwurf({ abfrage_sekunden: "60,5" }))).toEqual(["intervall"]);
    expect(einstellungsFehler(entwurf({ abfrage_sekunden: "" }))).toEqual(["intervall"]);
    expect(einstellungsFehler(entwurf({ abfrage_sekunden: "5" }))).toEqual([]);
    expect(einstellungsFehler(entwurf({ abfrage_sekunden: "86400" }))).toEqual([]);
  });

  it("verlangt min unter max", () => {
    expect(einstellungsFehler(entwurf({ temperatur_min: "30" }))).toEqual(["temperatur"]);
    expect(einstellungsFehler(entwurf({ feuchte_min: "80" }))).toEqual(["feuchte"]);
  });

  it("erlaubt eine leere Grenze", () => {
    expect(einstellungsFehler(entwurf({ temperatur_max: "" }))).toEqual([]);
  });

  it("weist Text zurück, der keine Zahl ist", () => {
    expect(einstellungsFehler(entwurf({ feuchte_max: "viel" }))).toEqual(["zahl"]);
  });
});

describe("einstellungenAusEntwurf", () => {
  it("macht Zahlen aus dem Entwurf, mit Komma, leer bleibt leer", () => {
    expect(einstellungenAusEntwurf(entwurf({ temperatur_min: "16,5", feuchte_max: " " }))).toEqual({
      abfrage_sekunden: 3600,
      temperatur_min: 16.5,
      temperatur_max: 30,
      feuchte_min: 30,
      feuchte_max: null,
    });
  });
});

describe("alleSeiten", () => {
  it("holt weiter, bis eine Seite nicht mehr voll ist", async () => {
    const daten = Array.from({ length: 2345 }, (_, i) => i);
    const aufrufe: [number, number][] = [];
    const alle = await alleSeiten(async (von, bis) => {
      aufrufe.push([von, bis]);
      return daten.slice(von, bis + 1);
    }, 1000);
    expect(alle).toEqual(daten);
    expect(aufrufe).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("fragt bei genau voller letzter Seite noch einmal nach", async () => {
    const daten = Array.from({ length: 4 }, (_, i) => i);
    const alle = await alleSeiten(async (von, bis) => daten.slice(von, bis + 1), 2);
    expect(alle).toEqual(daten);
  });
});
