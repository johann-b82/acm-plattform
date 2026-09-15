import { describe, expect, it } from "vitest";

import { anlageFehler, filtereAudits, phasenFehler, type Audit } from "@/lib/audit";

const audit = (teil: Partial<Audit>): Audit => ({
  id: "a",
  nummer: "IA-2026-1",
  titel: "Management",
  art: "intern",
  bereich: "",
  ziel: "",
  leitender_auditor: null,
  team: "",
  geplant_von: null,
  geplant_bis: null,
  prioritaet: 2,
  status: "geplant",
  vorlage_id: null,
  version: 1,
  ...teil,
});

describe("filtereAudits", () => {
  const liste = [
    audit({ id: "1", status: "geplant", art: "intern" }),
    audit({ id: "2", status: "abgeschlossen", art: "intern" }),
    audit({ id: "3", status: "geplant", art: "extern" }),
  ];
  const ids = (l: Audit[]) => l.map((a) => a.id);

  it("zeigt bei „Alle“ alles", () => {
    expect(ids(filtereAudits(liste, { status: "", art: "" }))).toEqual(["1", "2", "3"]);
  });

  it("filtert nach Status und nach Art, auch zusammen", () => {
    expect(ids(filtereAudits(liste, { status: "geplant", art: "" }))).toEqual(["1", "3"]);
    expect(ids(filtereAudits(liste, { status: "", art: "intern" }))).toEqual(["1", "2"]);
    expect(ids(filtereAudits(liste, { status: "geplant", art: "extern" }))).toEqual(["3"]);
  });

  it("kann leer ausgehen", () => {
    expect(filtereAudits(liste, { status: "abgesagt", art: "" })).toEqual([]);
  });
});

describe("anlageFehler", () => {
  const neu = {
    nummer: "IA-1",
    titel: "T",
    kategorien: ["prozess"],
    geplant_von: "",
    geplant_bis: "",
  };

  it("lässt eine vollständige Anlage durch", () => {
    expect(anlageFehler(neu)).toEqual([]);
  });

  it("verlangt Nummer, Titel und mindestens eine Kategorie", () => {
    expect(anlageFehler({ ...neu, nummer: " ", titel: "", kategorien: [] })).toEqual([
      "nummer",
      "titel",
      "kategorie",
    ]);
  });

  it("lässt das Ende nicht vor dem Beginn liegen, gleich ist erlaubt", () => {
    expect(anlageFehler({ ...neu, geplant_von: "2026-04-02", geplant_bis: "2026-04-01" })).toEqual([
      "zeitraum",
    ]);
    expect(anlageFehler({ ...neu, geplant_von: "2026-04-02", geplant_bis: "2026-04-02" })).toEqual([]);
    expect(anlageFehler({ ...neu, geplant_von: "", geplant_bis: "2026-04-01" })).toEqual([]);
  });
});

describe("phasenFehler", () => {
  const entwurf = {
    status: "offen" as const,
    erledigt_am: "",
    uebersprungen_warum: "",
  };

  it("lässt eine offene Phase ohne Weiteres durch", () => {
    expect(phasenFehler(entwurf, true)).toBeNull();
  });

  it("verlangt bei einer Pflichtphase, die entfällt, eine Begründung", () => {
    expect(phasenFehler({ ...entwurf, status: "nicht_zutreffend" }, true)).toBe("grund");
    expect(
      phasenFehler({ ...entwurf, status: "nicht_zutreffend", uebersprungen_warum: "  " }, true),
    ).toBe("grund");
    expect(
      phasenFehler({ ...entwurf, status: "nicht_zutreffend", uebersprungen_warum: "entfällt" }, true),
    ).toBeNull();
  });

  it("lässt eine freiwillige Phase ohne Begründung entfallen", () => {
    expect(phasenFehler({ ...entwurf, status: "nicht_zutreffend" }, false)).toBeNull();
  });

  it("verlangt für „erledigt“ ein Ist-Datum", () => {
    expect(phasenFehler({ ...entwurf, status: "erledigt" }, false)).toBe("datum");
    expect(phasenFehler({ ...entwurf, status: "erledigt", erledigt_am: "2026-09-12" }, false)).toBeNull();
  });
});
