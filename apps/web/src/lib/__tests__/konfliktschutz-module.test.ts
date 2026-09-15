/**
 * Konfliktschutz in den Modulen der Phase 1 (ADR-0006): jedes Speichern und
 * Löschen geht mit der geladenen Version, und jedes Lesen holt sie mit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reihenfolge = vi.hoisted(() => [] as string[]);
const auswahl = vi.hoisted(() => [] as { tabelle: string; felder: string }[]);

type Aufruf<T> = (...args: unknown[]) => Promise<T>;

const versioniert = vi.hoisted(() => ({
  speichereVersioniert: vi.fn<Aufruf<number>>(async () => 2),
  loescheVersioniert: vi.fn<Aufruf<void>>(async () => {
    reihenfolge.push("zeile");
  }),
  pruefeVersion: vi.fn<Aufruf<void>>(async () => {
    reihenfolge.push("pruefen");
  }),
}));
vi.mock("@/lib/versioniert", () => versioniert);

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: (tabelle: string) => {
      const kette: Record<string, unknown> = {};
      for (const m of ["eq", "order", "range", "like", "in", "is", "limit"]) kette[m] = () => kette;
      kette.select = (felder: string) => {
        auswahl.push({ tabelle, felder });
        return kette;
      };
      kette.maybeSingle = () => Promise.resolve({ data: null, error: null });
      kette.then = (weiter: (antwort: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(weiter);
      return kette;
    },
    storage: {
      from: () => ({
        remove: async () => {
          reihenfolge.push("dateien");
          return { error: null };
        },
      }),
    },
  }),
}));

import { lieferungApi, type AtrPosition, type Lieferung } from "@/lib/atr";
import { auditApi, type Audit, type Phase } from "@/lib/audit";
import { wartungApi, type Aufgabe, type Datei, type Maschine } from "@/lib/wartung";
import { feedbackApi, type Feedback } from "@/lib/feedback";

const LIEFERUNG = { id: "l1", version: 3 } as Lieferung;
const POSITION = { id: "p1", version: 5 } as AtrPosition;
const AUDIT = { id: "a1", version: 2 } as Audit;
const PHASE = { id: "ph1", version: 7 } as Phase;
const MASCHINE = { id: "m1", version: 4 } as Maschine;
const AUFGABE = { id: "w1", version: 1 } as Aufgabe;
const MELDUNG = { id: "f1", version: 6, bild_pfad: "u/bild.jpg" } as Feedback;

beforeEach(() => {
  reihenfolge.length = 0;
  auswahl.length = 0;
  vi.clearAllMocks();
});

describe("Speichern mit der geladenen Version", () => {
  it.each([
    ["ATR-Lieferung", () => lieferungApi.aendern(LIEFERUNG, { atr_nummer: "A" }), "atr_lieferungen", "l1", 3, { atr_nummer: "A" }],
    ["ATR-Position", () => lieferungApi.positionAendern(POSITION, { gewicht_kg: "1.5" }), "atr_positionen", "p1", 5, { gewicht_kg: "1.5" }],
    ["Audit", () => auditApi.aendern(AUDIT, { status: "berichtet" }), "audits", "a1", 2, { status: "berichtet" }],
    ["Audit-Phase", () => auditApi.phaseAendern(PHASE, { kommentar: "ok" }), "audit_phasen", "ph1", 7, { kommentar: "ok" }],
    ["Maschine", () => wartungApi.aendern(MASCHINE, { name: "Fräse 4" }), "maschinen", "m1", 4, { name: "Fräse 4" }],
    ["Wartungsaufgabe", () => wartungApi.aufgabeAendern(AUFGABE, { titel: "Öl" }), "wartungsaufgaben", "w1", 1, { titel: "Öl" }],
    ["Feedback-Status", () => feedbackApi.status(MELDUNG, "erledigt"), "feedback", "f1", 6, { status: "erledigt" }],
    ["Feedback-Zuweisung", () => feedbackApi.zuweisen(MELDUNG, "u2"), "feedback", "f1", 6, { zugewiesen: "u2" }],
  ])("%s", async (_name, aufruf, tabelle, id, version, felder) => {
    await aufruf();
    expect(versioniert.speichereVersioniert).toHaveBeenCalledWith(tabelle, id, version, felder);
  });
});

describe("Löschen mit der geladenen Version", () => {
  it.each([
    ["ATR-Lieferung", () => lieferungApi.loeschen(LIEFERUNG), "atr_lieferungen", "l1", 3],
    ["ATR-Position", () => lieferungApi.positionLoeschen(POSITION), "atr_positionen", "p1", 5],
    ["Wartungsaufgabe", () => wartungApi.aufgabeLoeschen(AUFGABE), "wartungsaufgaben", "w1", 1],
    ["Maschine", () => wartungApi.loeschen(MASCHINE, []), "maschinen", "m1", 4],
    ["Feedback", () => feedbackApi.loeschen(MELDUNG), "feedback", "f1", 6],
  ])("%s", async (_name, aufruf, tabelle, id, version) => {
    await aufruf();
    expect(versioniert.loescheVersioniert).toHaveBeenCalledWith(tabelle, id, version);
  });

  it("prüft die Version, bevor Dateien einer Maschine verschwinden", async () => {
    await wartungApi.loeschen(MASCHINE, [{ pfad: "m1/plan.pdf" } as Datei]);
    expect(versioniert.pruefeVersion).toHaveBeenCalledWith("maschinen", "m1", 4);
    expect(reihenfolge).toEqual(["pruefen", "dateien", "zeile"]);
  });

  it("prüft die Version, bevor das Bild einer Meldung verschwindet", async () => {
    await feedbackApi.loeschen(MELDUNG);
    expect(versioniert.pruefeVersion).toHaveBeenCalledWith("feedback", "f1", 6);
    expect(reihenfolge).toEqual(["pruefen", "dateien", "zeile"]);
  });

  it("lässt die Dateien liegen, wenn jemand anders schneller war", async () => {
    versioniert.pruefeVersion.mockRejectedValueOnce(new Error("Konflikt"));
    await expect(wartungApi.loeschen(MASCHINE, [{ pfad: "m1/plan.pdf" } as Datei])).rejects.toThrow("Konflikt");
    expect(reihenfolge).not.toContain("dateien");
    expect(versioniert.loescheVersioniert).not.toHaveBeenCalled();
  });
});

describe("Lesen holt die Version mit", () => {
  it.each([
    ["ATR-Lieferungen", () => lieferungApi.liste(), "atr_lieferungen"],
    ["ATR-Lieferung", () => lieferungApi.eine("l1"), "atr_lieferungen"],
    ["ATR-Positionen", () => lieferungApi.positionen("l1"), "atr_positionen"],
    ["Audits", () => auditApi.liste(), "audits"],
    ["Audit", () => auditApi.eines("a1"), "audits"],
    ["Audit-Phasen", () => auditApi.phasen("a1"), "audit_phasen"],
    ["Maschinen", () => wartungApi.maschinen(), "maschinen"],
    ["Maschine", () => wartungApi.maschine("m1"), "maschinen"],
    ["Wartungsaufgaben", () => wartungApi.aufgaben("m1"), "wartungsaufgaben"],
    ["Feedback-Liste", () => feedbackApi.liste(), "feedback"],
    ["Feedback zur Seite", () => feedbackApi.zurSeite("/atr"), "feedback"],
  ])("%s", async (_name, aufruf, tabelle) => {
    await aufruf();
    const felder = auswahl.filter((a) => a.tabelle === tabelle).map((a) => a.felder.split(","));
    expect(felder.length).toBeGreaterThan(0);
    for (const liste of felder) expect(liste).toContain("version");
  });
});
