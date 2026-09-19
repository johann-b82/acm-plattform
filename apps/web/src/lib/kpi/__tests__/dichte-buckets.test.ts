/**
 * Fehlende Buckets mit Nullen füllen, damit ein Verlauf keine Löcher hat.
 *
 * Die Datenbank liefert nur Buckets mit Daten. Über einen langen Zeitraum
 * fehlen dazwischen Monate — dann zerfällt die Fläche in Inseln. `dichteBuckets`
 * schließt genau diese Lücken, ohne führende oder nachlaufende Leere zu erfinden.
 */
import { describe, expect, it } from "vitest";

import { dichteBuckets } from "@/lib/kpi/gemeinsam";

const leer = (bucket: string) => ({ bucket, wert: 0 });

describe("dichteBuckets", () => {
  it("füllt fehlende Monate zwischen erstem und letztem Wert mit Null", () => {
    const dicht = dichteBuckets(
      [
        { bucket: "2024-01-01", wert: 5 },
        { bucket: "2024-04-01", wert: 3 },
      ],
      "month",
      leer,
    );
    expect(dicht.map((z) => z.bucket)).toEqual([
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
    ]);
    expect(dicht.map((z) => z.wert)).toEqual([5, 0, 0, 3]);
  });

  it("überbrückt den Jahreswechsel im Monatstakt", () => {
    const dicht = dichteBuckets(
      [
        { bucket: "2023-11-01", wert: 1 },
        { bucket: "2024-02-01", wert: 2 },
      ],
      "month",
      leer,
    );
    expect(dicht.map((z) => z.bucket)).toEqual([
      "2023-11-01",
      "2023-12-01",
      "2024-01-01",
      "2024-02-01",
    ]);
  });

  it("schließt Wochenlücken in Siebentageschritten", () => {
    const dicht = dichteBuckets(
      [
        { bucket: "2024-01-01", wert: 1 },
        { bucket: "2024-01-22", wert: 1 },
      ],
      "week",
      leer,
    );
    expect(dicht.map((z) => z.bucket)).toEqual([
      "2024-01-01",
      "2024-01-08",
      "2024-01-15",
      "2024-01-22",
    ]);
  });

  it("erfindet keine führende oder nachlaufende Leere", () => {
    const dicht = dichteBuckets(
      [
        { bucket: "2024-03-01", wert: 7 },
        { bucket: "2024-04-01", wert: 8 },
      ],
      "month",
      leer,
    );
    expect(dicht).toHaveLength(2);
  });

  it("lässt eine einzelne Zeile unangetastet", () => {
    expect(dichteBuckets([{ bucket: "2024-03-01", wert: 7 }], "month", leer)).toEqual([
      { bucket: "2024-03-01", wert: 7 },
    ]);
    expect(dichteBuckets([], "month", leer)).toEqual([]);
  });
});
