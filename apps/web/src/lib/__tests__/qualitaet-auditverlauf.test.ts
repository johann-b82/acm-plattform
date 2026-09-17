/**
 * Audit-Findings im Zeitverlauf: je Level ein Diagramm, die vier Auditarten
 * darin gestapelt.
 *
 * Vorher zeigte ein einziges Diagramm Level 1 gegen Level 2, und die Auditart
 * war nur noch ein Filter — die Aufschlüsselung, die die Datenbank ohnehin
 * liefert, fiel unter den Tisch. Im Altprojekt (`QualityKpiCharts.tsx`) steht
 * sie gestapelt in beiden Diagrammen.
 */
import { describe, expect, it } from "vitest";

import { AUDIT_ARTEN, verlaufJeArt, type AuditVerlaufZeile } from "@/lib/kpi/qualitaet";

const ZEILEN: AuditVerlaufZeile[] = [
  { bucket: "2026-01-01", art: "BH AUD", level_1: 2, level_2: 5 },
  { bucket: "2026-01-01", art: "IN AUD", level_1: 1, level_2: 0 },
  { bucket: "2026-03-01", art: "KU AUD", level_1: 0, level_2: 4 },
];

describe("verlaufJeArt", () => {
  it("macht aus jeder Auditart einen eigenen Schlüssel", () => {
    expect(verlaufJeArt(ZEILEN, 1, AUDIT_ARTEN)).toEqual([
      { bucket: "2026-01-01", "BH AUD": 2, "EX AUD": 0, "IN AUD": 1, "KU AUD": 0 },
      { bucket: "2026-03-01", "BH AUD": 0, "EX AUD": 0, "IN AUD": 0, "KU AUD": 0 },
    ]);
  });

  it("zählt für Level 2 die anderen Zahlen", () => {
    const l2 = verlaufJeArt(ZEILEN, 2, AUDIT_ARTEN);
    expect(l2[0]).toMatchObject({ "BH AUD": 5, "IN AUD": 0 });
    expect(l2[1]).toMatchObject({ "KU AUD": 4 });
  });

  it("nimmt nur die gewählten Arten, in fester Reihenfolge", () => {
    // Beim Filtern darf keine Farbe springen: die Reihenfolge kommt aus
    // AUDIT_ARTEN, nicht aus der Reihenfolge des Anklickens.
    const nurZwei = verlaufJeArt(ZEILEN, 1, ["IN AUD", "BH AUD"]);
    expect(Object.keys(nurZwei[0])).toEqual(["bucket", "IN AUD", "BH AUD"]);
    expect(nurZwei[0]).toMatchObject({ "BH AUD": 2, "IN AUD": 1 });
  });

  it("lässt Zeiträume ohne jede Zeile aus", () => {
    // Februar fehlt in den Daten — eine erfundene Null wäre eine Aussage, die
    // die Datenbank nicht trifft.
    expect(verlaufJeArt(ZEILEN, 1, AUDIT_ARTEN).map((z) => z.bucket)).toEqual([
      "2026-01-01",
      "2026-03-01",
    ]);
  });

  it("sortiert nach Zeitraum", () => {
    const verdreht = [...ZEILEN].reverse();
    expect(verlaufJeArt(verdreht, 1, AUDIT_ARTEN).map((z) => z.bucket)).toEqual([
      "2026-01-01",
      "2026-03-01",
    ]);
  });
});
