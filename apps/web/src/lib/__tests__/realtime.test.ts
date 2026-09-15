/**
 * Realtime und Konfliktschutz (ADR-0006): die reinen Regeln ohne Kanal.
 */
import { describe, expect, it } from "vitest";

import {
  KonfliktFehler,
  anwesende,
  datensatzThema,
  leereAntwort,
  schluesselFuer,
  tabellenThema,
} from "@/lib/realtime";

describe("Kanäle", () => {
  it("nennt je Tabelle und je Datensatz einen eigenen Kanal, wie die Datenbank ihn prüft", () => {
    expect(tabellenThema("atr_lieferungen")).toBe("tabelle:atr_lieferungen");
    expect(datensatzThema("audits", "a1")).toBe("datensatz:audits:a1");
  });
});

describe("Neu laden nach einer Änderung", () => {
  it("lädt die Abfragen des Moduls, zu dem die Tabelle gehört", () => {
    expect(schluesselFuer("atr_lieferungen")).toEqual([["atr"]]);
    expect(schluesselFuer("atr_positionen")).toEqual([["atr"]]);
    expect(schluesselFuer("audits")).toEqual([["audit"]]);
    expect(schluesselFuer("audit_phasen")).toEqual([["audit"]]);
    expect(schluesselFuer("maschinen")).toEqual([["wartung"]]);
    expect(schluesselFuer("wartungsaufgaben")).toEqual([["wartung"]]);
    // Die Glocke zählt App Feedback — sie hängt an einem eigenen Schlüssel.
    expect(schluesselFuer("feedback")).toEqual([["feedback"]]);
  });

  it("kennt keine Tabelle, die nicht freigegeben ist", () => {
    expect(schluesselFuer("personio_employees")).toEqual([]);
  });
});

describe("Speichern auf veraltetem Stand", () => {
  it("unterscheidet, warum ein Speichern keine Zeile traf", () => {
    // Die Zeile gibt es noch, aber mit neuerer Version: jemand war schneller.
    expect(leereAntwort({ version: 4 }, 3)).toBe("konflikt");
    // Die Zeile ist weg: jemand hat sie gelöscht.
    expect(leereAntwort(null, 3)).toBe("geloescht");
    // Gleiche Version und trotzdem nichts getroffen: die Regel hat abgewiesen.
    expect(leereAntwort({ version: 3 }, 3)).toBe("recht");
  });

  it("erkennt den Konflikt am eigenen Fehlertyp", () => {
    const fehler = new KonfliktFehler("geloescht");
    expect(fehler).toBeInstanceOf(Error);
    expect(fehler.grund).toBe("geloescht");
    expect(KonfliktFehler.ist(fehler)).toBe(true);
    expect(KonfliktFehler.ist(new Error("anders"))).toBe(false);
  });
});

describe("Anwesenheit", () => {
  it("nennt die anderen, jede Person einmal, ohne einen selbst", () => {
    const zustand = {
      a: [{ kennung: "u1", email: "anna@acm.local" }],
      b: [{ kennung: "u2", email: "zoe@acm.local" }, { kennung: "u2", email: "zoe@acm.local" }],
      c: [{ kennung: "ich", email: "ich@acm.local" }],
      d: [{ kennung: "u3", email: "bert@acm.local" }],
    };
    expect(anwesende(zustand, "ich")).toEqual(["anna@acm.local", "bert@acm.local", "zoe@acm.local"]);
  });

  it("übergeht Einträge ohne Adresse", () => {
    expect(anwesende({ a: [{ kennung: "u1" }] }, "ich")).toEqual([]);
  });
});
