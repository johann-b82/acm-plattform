import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ohneLevel,
  pruefleistungVergleich,
  pruefungApi,
  qualitaetApi,
  reklamationApi,
  type AuditFinding,
} from "../qualitaet";

/**
 * Was die Qualitätsseite an die Datenbank schickt und wie sie die Antwort
 * liest. Die Rechenwege selbst prüfen die Datenbanktests in compute.
 */

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ rpc }),
}));

function antwort(data: unknown) {
  rpc.mockResolvedValueOnce({ data, error: null });
}

beforeEach(() => rpc.mockReset());

describe("Prüfleistung", () => {
  it("schickt die Artikelart mit und liest Zahlen aus Text", async () => {
    antwort([
      {
        gross: "16.9",
        klein: "162.8",
        gesamt: "42.1",
        personentage_gross: 241,
        personentage_klein: 42,
        personentage_gesamt: 259,
      },
    ]);
    const m = await pruefungApi.mengen("2026-01-01", "2026-09-12", "halbfertig");
    expect(rpc).toHaveBeenCalledWith("kpi_qualitaet_pruefmengen", {
      von: "2026-01-01",
      bis: "2026-09-12",
      artikelart: "halbfertig",
    });
    expect(m).toEqual({
      gross: 16.9,
      klein: 162.8,
      gesamt: 42.1,
      personentage_gross: 241,
      personentage_klein: 42,
      personentage_gesamt: 259,
    });
  });

  it("zeigt ohne Antwortzeile Nullen", async () => {
    antwort([]);
    const m = await pruefungApi.mengen(null, null, "fertig");
    expect(m.gesamt).toBe(0);
    expect(m.personentage_gesamt).toBe(0);
  });

  it("fragt den Verlauf im Takt des Fensters ab", async () => {
    antwort([{ bucket: "2026-03-01", gross: "400.0", klein: "0.0", gesamt: "400.0", personentage_gross: 2, personentage_klein: 0, personentage_gesamt: 2 }]);
    const punkte = await pruefungApi.verlauf("2026-01-01", "2026-09-12", "alle");
    expect(rpc).toHaveBeenCalledWith("kpi_qualitaet_pruefmengen_verlauf", {
      von: "2026-01-01",
      bis: "2026-09-12",
      takt: "month",
      artikelart: "alle",
    });
    expect(punkte[0]).toMatchObject({ bucket: "2026-03-01", gross: 400, klein: 0 });
  });

  it("holt die Buchungen ohne Obergrenze", async () => {
    antwort([]);
    await pruefungApi.buchungen(null, null, "fertig");
    expect(rpc).toHaveBeenCalledWith("kpi_qualitaet_buchungen", { von: null, bis: null, artikelart: "fertig" });
  });

  it("vergleicht nur, wenn im Vergleichsfenster jemand geprüft hat", () => {
    const m = { gross: 0, klein: 12.5, gesamt: 12.5, personentage_gross: 0, personentage_klein: 3, personentage_gesamt: 3 };
    // Eine 0 ohne Prüfer-Tage ist keine Leistung von null, sondern keine Basis.
    expect(pruefleistungVergleich(m, "gross")).toBeNull();
    expect(pruefleistungVergleich(m, "klein")).toBe(12.5);
    expect(pruefleistungVergleich(undefined, "gesamt")).toBeNull();
  });
});

describe("Findings", () => {
  it("holt die Liste mit dem Auditartfilter", async () => {
    antwort([]);
    await qualitaetApi.liste("2026-01-01", "2026-12-31", ["KU AUD"]);
    expect(rpc).toHaveBeenCalledWith("kpi_qualitaet_audits_liste", {
      von: "2026-01-01",
      bis: "2026-12-31",
      arten: ["KU AUD"],
    });
  });

  it("liest die Diagnoseliste aus derselben Menge", () => {
    const liste = [
      { report_nr: "A", level: 1 },
      { report_nr: "B", level: null },
      { report_nr: "C", level: 2 },
    ] as AuditFinding[];
    expect(ohneLevel(liste).map((z) => z.report_nr)).toEqual(["B"]);
  });
});

describe("Reklamationen", () => {
  it("holt die Liste der gewählten Art und liest Mengen als Zahl", async () => {
    antwort([
      { report_nr: "R-1", report_date: "2026-03-01", quantity: "30.000", accepted_quantity: null },
    ]);
    const zeilen = await reklamationApi.liste("lieferant", null, "2026-09-12");
    expect(rpc).toHaveBeenCalledWith("kpi_qualitaet_reklamationen_liste", {
      p_art: "lieferant",
      von: null,
      bis: "2026-09-12",
    });
    expect(zeilen[0].quantity).toBe(30);
    expect(zeilen[0].accepted_quantity).toBeNull();
  });
});
