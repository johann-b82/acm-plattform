/**
 * Die Rechenwege hinter den HR-Seiten: Personenwahl, Matrixspalten,
 * Fälligkeiten und Abteilungen. Die Abgrenzungen folgen dem Altsystem; die
 * Fälle hier sind die, an denen die Zahlen sonst auseinanderlaufen.
 */
import { describe, expect, it } from "vitest";

import { personenwahl, type Eintritt } from "@/lib/onboarding";
import { abteilungsachse } from "@/lib/einarbeitung";
import {
  abteilungenMitVorgesetzten,
  effektiveFaelligkeit,
  faelligeSchulungen,
  faelligkeitsstatus,
  imStandort,
  mitarbeiterstand,
  ohneTermin,
  standorte,
  tagesdatum,
  type Person,
  type Schulung,
  type Stand,
} from "@/lib/schulungen";
import { gruppiere, type Qualifikation } from "@/lib/kompetenzen";
import { bausteinSchluessel, geaenderteBausteine } from "@/lib/zeugnisse";

const HEUTE = new Date(2026, 8, 12);

function eintritt(felder: Partial<Eintritt>): Eintritt {
  return {
    employee_id: 1,
    extern_id: null,
    name: "Person",
    abteilung: null,
    abteilung_gesetzt: false,
    position: null,
    eintritt: null,
    status: "active",
    heruntergeladen_am: null,
    ...felder,
  };
}

describe("personenwahl", () => {
  const liste = [
    eintritt({ employee_id: 1, eintritt: "2026-08-01", status: "active" }),
    eintritt({ employee_id: 2, eintritt: "2026-09-30", status: "onboarding" }),
    eintritt({ employee_id: 3, eintritt: "2020-01-01", status: "inactive" }),
    eintritt({ employee_id: 4, eintritt: "2026-08-15", status: "active", heruntergeladen_am: "2026-08-20" }),
    eintritt({ employee_id: null, extern_id: "x", eintritt: null, status: "active" }),
  ];
  const ids = (l: readonly Eintritt[]) => l.map((e) => e.employee_id ?? e.extern_id);

  it("Neu behält künftige Eintritte und lässt übergebene weg", () => {
    expect(ids(personenwahl(liste, "neu", HEUTE))).toEqual([1, 2]);
  });

  it("Aktive folgt dem Personio-Status, nicht dem Eintrittsdatum", () => {
    expect(ids(personenwahl(liste, "aktive", HEUTE))).toEqual([1, 4, "x"]);
  });

  it("Alle ist die ganze Liste", () => {
    expect(personenwahl(liste, "alle", HEUTE)).toHaveLength(5);
  });
});

describe("abteilungsachse", () => {
  it("vereint Personio und gepflegte Abteilungen, ohne Leerwerte und Doppel", () => {
    expect(abteilungsachse(["Production", " IT ", null, "", "Production"], ["Altabteilung", "IT"])).toEqual([
      "Altabteilung",
      "IT",
      "Production",
    ]);
  });
});

function stand(felder: Partial<Stand>): Stand {
  return {
    teilnahme_id: "t",
    schulung_id: "s1",
    employee_id: 1,
    extern_id: null,
    schluessel: "e:1",
    mitarbeiter_name: "Anna",
    abteilung_kuerzel: null,
    bereich: "betrieblich",
    schulung: "Brandschutz",
    turnus_monate: 12,
    aktuell_datum: null,
    faellig_am: null,
    ueberfaellig: false,
    nie_absolviert: true,
    ...felder,
  };
}

function person(felder: Partial<Person>): Person {
  return {
    schluessel: "e:1",
    employee_id: 1,
    extern_id: null,
    personalnummer: null,
    name: "Anna",
    abteilung: "Production",
    eintritt: "2026-01-01",
    herkunft: "personio",
    standort: "Hamburg",
    ...felder,
  };
}

function schulung(felder: Partial<Schulung>): Schulung {
  return {
    id: "s1",
    bereich: "betrieblich",
    name: "Brandschutz",
    turnus: "jährlich",
    turnus_monate: 12,
    frist_tage: null,
    verantwortlicher: null,
    beschreibung: null,
    sortierung: 0,
    aktiv: true,
    ...felder,
  };
}

describe("Fälligkeit", () => {
  const heute = "2026-09-12";

  it("rechnet absolviert aus Termin und Turnus, nie absolviert aus Eintritt und Frist", () => {
    expect(effektiveFaelligkeit(stand({ aktuell_datum: "2025-09-01", faellig_am: "2026-09-01", nie_absolviert: false }), 30, "2020-01-01")).toBe("2026-09-01");
    expect(effektiveFaelligkeit(stand({}), 30, "2026-09-01")).toBe("2026-10-01");
    expect(effektiveFaelligkeit(stand({}), null, "2026-09-01")).toBeNull();
    expect(effektiveFaelligkeit(stand({}), 30, null)).toBeNull();
  });

  it("zählt drei Monate als bald, den Tag davor als überfällig", () => {
    expect(faelligkeitsstatus("2026-09-11", heute)).toBe("ueberfaellig");
    expect(faelligkeitsstatus("2026-09-12", heute)).toBe("bald");
    expect(faelligkeitsstatus("2026-12-11", heute)).toBe("bald");
    expect(faelligkeitsstatus("2026-12-12", heute)).toBe("ok");
    expect(faelligkeitsstatus(null, heute)).toBe("ohne_frist");
  });

  it("nimmt den Kalendertag des Browsers", () => {
    expect(tagesdatum(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("faelligeSchulungen", () => {
  const heute = "2026-09-12";
  const personen = [
    person({}),
    person({ schluessel: "e:2", employee_id: 2, name: "Bernd", standort: "Memmingen" }),
    person({ schluessel: "p:77", employee_id: null, herkunft: "ohne_zuordnung", standort: null }),
  ];
  const katalog = [schulung({}), schulung({ id: "s2", name: "Stapler", frist_tage: 30 }), schulung({ id: "s3", aktiv: false })];

  it("grenzt wie die Referenz ab: überfällig und bis 90 Tage, nur Belegschaft und aktive Schulungen", () => {
    const zeilen = faelligeSchulungen(
      [
        stand({ teilnahme_id: "a", aktuell_datum: "2025-08-01", faellig_am: "2026-08-01", nie_absolviert: false }),
        stand({ teilnahme_id: "b", schluessel: "e:2", employee_id: 2, aktuell_datum: "2025-12-01", faellig_am: "2026-12-01", nie_absolviert: false }),
        stand({ teilnahme_id: "c", aktuell_datum: "2026-01-01", faellig_am: "2027-01-01", nie_absolviert: false }),
        stand({ teilnahme_id: "d", schulung_id: "s2" }),
        stand({ teilnahme_id: "e" }),
        stand({ teilnahme_id: "f", schluessel: "p:77", employee_id: null, faellig_am: "2026-01-01", nie_absolviert: false, aktuell_datum: "2025-01-01" }),
        stand({ teilnahme_id: "g", schluessel: "e:9", employee_id: 9, faellig_am: "2026-01-01", nie_absolviert: false, aktuell_datum: "2025-01-01" }),
        stand({ teilnahme_id: "h", schulung_id: "s3", faellig_am: "2026-01-01", nie_absolviert: false, aktuell_datum: "2025-01-01" }),
      ],
      personen,
      katalog,
      heute,
    );
    expect(zeilen.map((z) => [z.stand.teilnahme_id, z.status, z.tage])).toEqual([
      ["d", "ueberfaellig", -224],
      ["a", "ueberfaellig", -42],
      ["b", "bald", 80],
    ]);
  });

  it("zeigt nie Absolviertes ohne Termin gesondert", () => {
    const zeilen = ohneTermin([stand({ teilnahme_id: "e" }), stand({ teilnahme_id: "d", schulung_id: "s2" })], personen, katalog);
    expect(zeilen.map((z) => z.stand.teilnahme_id)).toEqual(["e"]);
  });

  it("zählt je Person, auch wer noch nichts hat", () => {
    const zeilen = mitarbeiterstand(
      [stand({ teilnahme_id: "a", aktuell_datum: "2025-08-01", faellig_am: "2026-08-01", nie_absolviert: false }), stand({ teilnahme_id: "e" })],
      personen,
      katalog,
      heute,
    );
    expect(zeilen.map((z) => [z.person.name, z.schulungen, z.ueberfaellig, z.bald, z.naechste])).toEqual([
      ["Anna", 2, 1, 0, "2026-08-01"],
      ["Bernd", 0, 0, 0, null],
    ]);
  });

  it("filtert nach Standort, leere Auswahl heißt alle", () => {
    expect(standorte(personen)).toEqual(["Hamburg", "Memmingen"]);
    expect(personen.filter((p) => imStandort(p, new Set())).length).toBe(3);
    expect(personen.filter((p) => imStandort(p, new Set(["Memmingen"]))).map((p) => p.name)).toEqual(["Bernd"]);
  });
});

describe("abteilungenMitVorgesetzten", () => {
  it("zählt Köpfe und ordnet Vorgesetzte nach Häufigkeit, nur aktive", () => {
    const ergebnis = abteilungenMitVorgesetzten([
      { id: 1, name: "Chefin", department: "Production", vorgesetzter_id: null },
      { id: 2, name: "Meister", department: "Production", vorgesetzter_id: 1 },
      { id: 3, name: "A", department: "Production", vorgesetzter_id: 2 },
      { id: 4, name: "B", department: "Production", vorgesetzter_id: 2 },
      { id: 5, name: "C", department: "IT", vorgesetzter_id: 99 },
      { id: 6, name: "D", department: " ", vorgesetzter_id: 1 },
    ]);
    expect(ergebnis).toEqual([
      { abteilung: "Production", mitarbeiter: 4, vorgesetzte: ["Meister", "Chefin"] },
      { abteilung: "IT", mitarbeiter: 1, vorgesetzte: [] },
    ]);
  });
});

function qualifikation(id: string, reihenfolge: number, kategorie: string | null): Qualifikation {
  return { id, matrix_id: "m", nr: null, kategorie, bezeichnung: id, reihenfolge };
}

describe("gruppiere", () => {
  it("hält die Reihenfolge der Matrix und sammelt Zeilen ohne Kategorie am Ende", () => {
    const gruppen = gruppiere([
      qualifikation("c", 3, "Sprachen"),
      qualifikation("a", 1, "Maschinen"),
      qualifikation("x", 2, null),
      qualifikation("b", 4, "Maschinen"),
      qualifikation("d", 5, " "),
    ]);
    expect(gruppen.map((g) => [g.kategorie, g.zeilen.map((q) => q.id)])).toEqual([
      ["Maschinen", ["a", "b"]],
      ["Sprachen", ["c"]],
      [null, ["x", "d"]],
    ]);
  });
});

describe("geaenderteBausteine", () => {
  it("liefert nur geänderte, nicht leere Formulierungen", () => {
    const bestand = [
      { dimension: "fachwissen", note: 1, text: "sehr gut" },
      { dimension: "fachwissen", note: 2, text: "gut" },
    ];
    expect(
      geaenderteBausteine(bestand, {
        [bausteinSchluessel("fachwissen", 1)]: "sehr gut",
        [bausteinSchluessel("fachwissen", 2)]: "gut und sicher",
        [bausteinSchluessel("fuehrung", 3)]: "   ",
        [bausteinSchluessel("arbeitsweise", 4)]: "neu",
      }),
    ).toEqual([
      { dimension: "arbeitsweise", note: 4, text: "neu" },
      { dimension: "fachwissen", note: 2, text: "gut und sicher" },
    ]);
  });
});
