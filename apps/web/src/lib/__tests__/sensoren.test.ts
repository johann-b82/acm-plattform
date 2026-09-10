import { describe, expect, it } from "vitest";

import { ausserhalb, farbeVon, zustand, type Sensor, type Stand } from "@/lib/sensoren";

const sensor = (teil: Partial<Sensor> = {}): Sensor => ({
  id: "s1",
  name: "Serverraum",
  rechner: "sensor.acm.local",
  port: 161,
  temperatur_oid: "1.1",
  feuchte_oid: null,
  temperatur_faktor: "1",
  feuchte_faktor: "1",
  temperatur_min: null,
  temperatur_max: null,
  feuchte_min: null,
  feuchte_max: null,
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
    expect(zustand(stand(null), jetzt)).toBe("unbekannt");
    expect(zustand(undefined, jetzt)).toBe("unbekannt");
  });

  it("hält einen ausgelassenen Takt noch für frisch", () => {
    // Der Takt liegt bei fünf Minuten; UDP verliert gelegentlich ein Paket.
    expect(zustand(stand(vor(4)), jetzt)).toBe("frisch");
    expect(zustand(stand(vor(10)), jetzt)).toBe("frisch");
  });

  it("meldet ab dem dritten ausgelassenen Takt Verzögerung", () => {
    expect(zustand(stand(vor(15)), jetzt)).toBe("verzoegert");
  });

  it("nennt es offline, wenn eine Viertelstunde nichts mehr kam", () => {
    expect(zustand(stand(vor(45)), jetzt)).toBe("offline");
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
