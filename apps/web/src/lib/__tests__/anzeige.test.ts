/**
 * Die Bildschirmanzeigen — was ohne Browser prüfbar ist.
 *
 * Der Token selbst wird in compute geprüft (`tests/test_embed.py`); hier geht
 * es um die Adressbildung und die Beschriftung der Kacheln.
 */
import { describe, expect, it } from "vitest";

import { AnzeigeFehler, anzeigeApi, initialen, lohntNochmal, name, WOCHENTAGE } from "@/lib/anzeige";
import { sekundenAus } from "@/components/anzeige/blaettern";
import { zustandAus } from "@/components/anzeige/tafel";

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

describe("Zustand der Tafel", () => {
  const abfrage = (teile: Partial<{ isError: boolean; isSuccess: boolean; error: unknown }>) => ({
    isError: false,
    isSuccess: false,
    error: null,
    ...teile,
  });

  it("zeigt den Fehler, statt ihn als leere Woche auszugeben", () => {
    // Genau der Fall, der im Browser aufgefallen ist: ein abgelehnter Token
    // ließ die Tafel „niemand" melden. Auf einem Flurbildschirm sieht ein
    // kaputter Token damit aus wie eine ruhige Woche.
    const z = zustandAus(abfrage({ isError: true, error: new Error("Der Token ist unlesbar.") }), 0);
    expect(z).toEqual({ art: "fehler", text: "Der Token ist unlesbar." });
  });

  it("nennt auch einen Fehler, der keine Error-Instanz ist", () => {
    expect(zustandAus(abfrage({ isError: true, error: "irgendwas" }), 0)).toEqual({
      art: "fehler",
      text: "Unbekannter Fehler.",
    });
  });

  it("lädt, solange die Abfrage weder fertig noch gescheitert ist", () => {
    expect(zustandAus(abfrage({}), 0)).toEqual({ art: "laedt" });
  });

  it("ist erst leer, wenn die Abfrage durch ist und nichts geliefert hat", () => {
    expect(zustandAus(abfrage({ isSuccess: true }), 0)).toEqual({ art: "leer" });
  });

  it("zeigt Daten, sobald welche da sind", () => {
    expect(zustandAus(abfrage({ isSuccess: true }), 3)).toEqual({ art: "daten" });
  });
});

describe("Nachfassen", () => {
  it("fasst bei einem abgelehnten Token nicht nach", () => {
    // Solange nachgefasst wird, steht „Einen Moment" auf der Tafel — und
    // niemand sieht, dass die Adresse kaputt ist.
    expect(lohntNochmal(new AnzeigeFehler("Der Token ist unlesbar.", 403))).toBe(false);
  });

  it("fasst bei einem Serverfehler nach", () => {
    expect(lohntNochmal(new AnzeigeFehler("Personio antwortet nicht.", 502))).toBe(true);
  });

  it("fasst nach, wenn gar keine Antwort kam", () => {
    expect(lohntNochmal(new TypeError("Failed to fetch"))).toBe(true);
  });
});
