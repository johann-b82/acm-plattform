/**
 * Die Bildschirmanzeigen — was ohne Browser prüfbar ist.
 *
 * Der Token selbst wird in compute geprüft (`tests/test_embed.py`); hier geht
 * es um die Adressbildung und die Beschriftung der Kacheln.
 */
import { describe, expect, it } from "vitest";

import { anzeigeApi, initialen, name, WOCHENTAGE } from "@/lib/anzeige";
import { sekundenAus } from "@/components/anzeige/blaettern";

describe("Fotoadresse", () => {
  it("trägt den Token im Abfrageteil", () => {
    // `<img>` kann keinen Kopf setzen — deshalb überhaupt der Abfrageteil.
    expect(anzeigeApi.fotoUrl(42, "abc.def")).toBe("/api/anzeige/foto/42?token=abc.def");
  });

  it("kodiert einen Token mit Sonderzeichen", () => {
    expect(anzeigeApi.fotoUrl(1, "a+b/c=")).toBe("/api/anzeige/foto/1?token=a%2Bb%2Fc%3D");
  });
});

describe("Beschriftung", () => {
  it("setzt den Namen aus Vor- und Nachname", () => {
    expect(name({ id: 7, vorname: "Anna", nachname: "Berg" })).toBe("Anna Berg");
  });

  it("fällt auf die Nummer zurück, wenn Personio keinen Namen liefert", () => {
    expect(name({ id: 7, vorname: null, nachname: null })).toBe("#7");
  });

  it("bildet Initialen auch aus nur einem Namen", () => {
    expect(initialen("Anna", "Berg")).toBe("AB");
    expect(initialen(null, "Berg")).toBe("B");
    expect(initialen(null, null)).toBe("?");
  });

  it("nummeriert die Wochentage wie Python: Montag = 0", () => {
    expect(WOCHENTAGE[0]).toBe("Montag");
    expect(WOCHENTAGE[6]).toBe("Sonntag");
  });
});

describe("Anzeigedauer aus der Adresse", () => {
  const url = (such: string) => new URLSearchParams(such);

  it("nimmt, was der Player anhängt", () => {
    expect(sekundenAus(url("duration=25"))).toBe(25);
  });

  it("nimmt zehn Sekunden, wenn nichts dransteht", () => {
    expect(sekundenAus(url(""))).toBe(10);
  });

  it("ignoriert Unsinn statt mit NaN zu rechnen", () => {
    expect(sekundenAus(url("duration=bald"))).toBe(10);
    expect(sekundenAus(url("duration=0"))).toBe(10);
    expect(sekundenAus(url("duration=-5"))).toBe(10);
  });
});
