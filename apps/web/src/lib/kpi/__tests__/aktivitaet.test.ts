import { describe, expect, it } from "vitest";

import { verdichte } from "@/app/(app)/kpi/vertrieb/aktivitaet-karte";
import type { AktivitaetZeile } from "@/lib/kpi/vertrieb";

function zeile(teil: Partial<AktivitaetZeile>): AktivitaetZeile {
  return {
    iso_jahr: 2026,
    iso_woche: 1,
    erfasser: "MM",
    erstkontakte: 0,
    besuche_ort: 0,
    besuche_onl: 0,
    angebote_eur: 0,
    auftraege_eur: 0,
    ...teil,
  };
}

describe("Wochenzeilen verdichten", () => {
  it("summiert über die Vertriebler und merkt sich die Aufteilung", () => {
    const [woche] = verdichte(
      [
        zeile({ erfasser: "MM", erstkontakte: 3, besuche_ort: 1, besuche_onl: 2 }),
        zeile({ erfasser: "SB", erstkontakte: 2, besuche_ort: 1 }),
      ],
      [],
    );
    expect(woche.erstkontakte).toBe(5);
    // Besuche sind vor Ort plus online.
    expect(woche.besuche).toBe(4);
    expect(woche.anteile.erstkontakte).toEqual([
      ["MM", 3],
      ["SB", 2],
    ]);
  });

  it("hält Besuche vor Ort und online getrennt, ohne doppelt zu zählen", () => {
    const [woche] = verdichte(
      [
        zeile({ erfasser: "MM", besuche_ort: 1, besuche_onl: 2 }),
        zeile({ erfasser: "SB", besuche_ort: 1 }),
      ],
      [],
    );
    expect(woche.besuche_ort).toBe(2);
    expect(woche.besuche_onl).toBe(2);
    expect(woche.besuche).toBe(woche.besuche_ort + woche.besuche_onl);
    expect(woche.anteile.besuche_ort).toEqual([
      ["MM", 1],
      ["SB", 1],
    ]);
    expect(woche.anteile.besuche_onl).toEqual([["MM", 2]]);
  });

  it("lässt Vertriebler ohne Beitrag aus dem Tooltip", () => {
    const [woche] = verdichte(
      [
        zeile({ erfasser: "MM", erstkontakte: 3 }),
        zeile({ erfasser: "SB", angebote_eur: 500 }),
      ],
      [],
    );
    expect(woche.anteile.erstkontakte).toEqual([["MM", 3]]);
    expect(woche.anteile.angebote_eur).toEqual([["SB", 500]]);
  });

  it("führt Interessenten ohne Vertriebler in derselben Woche", () => {
    const [woche] = verdichte([zeile({ erstkontakte: 1 })], [
      { iso_jahr: 2026, iso_woche: 1, anzahl: 4 },
    ]);
    expect(woche.interessenten).toBe(4);
    expect(woche.anteile.interessenten).toBeUndefined();
  });

  it("legt eine Woche an, die es nur bei den Interessenten gibt", () => {
    const wochen = verdichte([], [{ iso_jahr: 2026, iso_woche: 9, anzahl: 2 }]);
    expect(wochen).toHaveLength(1);
    // Nur die Nummer, zweistellig: „KW" bzw. „W" kommt erst beim Zeichnen
    // dazu, damit das Diagramm in beiden Sprachen dasselbe Feld beschriftet.
    expect(wochen[0].label).toBe("09");
    expect(wochen[0].erstkontakte).toBe(0);
  });

  it("sortiert über den Jahreswechsel richtig", () => {
    const wochen = verdichte(
      [
        zeile({ iso_jahr: 2026, iso_woche: 2 }),
        zeile({ iso_jahr: 2025, iso_woche: 52 }),
        zeile({ iso_jahr: 2026, iso_woche: 1 }),
      ],
      [],
    );
    expect(wochen.map((w) => w.schluessel)).toEqual(["2025-52", "2026-01", "2026-02"]);
  });

  it("verkraftet Zahlen, die PostgREST als Zeichenkette liefert", () => {
    // numeric kommt über PostgREST als String an — ohne Number() stünde
    // "0500" statt 500 im Balken.
    const roh = [{ ...zeile({}), angebote_eur: "500" as unknown as number }];
    const [woche] = verdichte(roh, []);
    expect(woche.angebote_eur).toBe(500);
  });

  it("rechnet Stornos gegen, statt sie zu unterschlagen", () => {
    const [woche] = verdichte(
      [
        zeile({ erfasser: "MM", auftraege_eur: 7000 }),
        zeile({ erfasser: "SB", auftraege_eur: -1000 }),
      ],
      [],
    );
    expect(woche.auftraege_eur).toBe(6000);
    // Ein negativer Beitrag gehört nicht in die Aufteilung: der Tooltip
    // zeigt, wer Volumen geschrieben hat.
    expect(woche.anteile.auftraege_eur).toEqual([["MM", 7000]]);
  });
});
