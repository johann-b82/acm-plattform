/**
 * Speichern und Löschen mit der geladenen Version (ADR-0006) — gegen einen
 * nachgebildeten PostgREST-Aufruf. Geprüft wird, dass die Bedingung mitgeht
 * und dass eine leere Antwort richtig gedeutet wird.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Aufruf {
  tabelle: string;
  art: "update" | "delete" | "select";
  werte?: unknown;
  bedingungen: [string, unknown][];
  auswahl?: string;
}

const antworten = vi.hoisted(() => ({
  schreiben: { data: [] as unknown[] | null, error: null as { message: string } | null },
  lesen: { data: null as unknown, error: null as { message: string } | null },
}));
const aufrufe = vi.hoisted(() => [] as Aufruf[]);

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: (tabelle: string) => {
      const aufruf: Aufruf = { tabelle, art: "select", bedingungen: [] };
      const kette = {
        update: (werte: unknown) => ((aufruf.art = "update"), (aufruf.werte = werte), kette),
        delete: () => ((aufruf.art = "delete"), kette),
        eq: (spalte: string, wert: unknown) => (aufruf.bedingungen.push([spalte, wert]), kette),
        select: (auswahl: string) => {
          if (aufruf.art === "select") aufruf.auswahl = auswahl;
          aufrufe.push(aufruf);
          return aufruf.art === "select" ? kette : Promise.resolve(antworten.schreiben);
        },
        maybeSingle: () => Promise.resolve(antworten.lesen),
      };
      return kette;
    },
  }),
}));

import { KonfliktFehler } from "@/lib/realtime";
import { loescheVersioniert, pruefeVersion, speichereVersioniert } from "@/lib/versioniert";

beforeEach(() => {
  aufrufe.length = 0;
  antworten.schreiben = { data: [], error: null };
  antworten.lesen = { data: null, error: null };
});

describe("speichereVersioniert", () => {
  it("schreibt nur mit der geladenen Version", async () => {
    antworten.schreiben = { data: [{ id: "m1", version: 4 }], error: null };
    await speichereVersioniert("maschinen", "m1", 3, { name: "Fräse 4" });
    expect(aufrufe[0]).toMatchObject({
      tabelle: "maschinen",
      art: "update",
      werte: { name: "Fräse 4" },
      bedingungen: [["id", "m1"], ["version", 3]],
    });
  });

  it("schickt die Version nicht als Wert mit", async () => {
    antworten.schreiben = { data: [{ id: "m1", version: 4 }], error: null };
    await speichereVersioniert("maschinen", "m1", 3, { name: "X", version: 99 } as never);
    expect(aufrufe[0].werte).toEqual({ name: "X" });
  });

  it("meldet einen Konflikt, wenn jemand anders schneller war", async () => {
    antworten.lesen = { data: { version: 5 }, error: null };
    await expect(speichereVersioniert("audits", "a1", 3, { titel: "T" })).rejects.toSatisfy(
      (f: unknown) => KonfliktFehler.ist(f) && f.grund === "konflikt",
    );
    expect(aufrufe[1]).toMatchObject({ tabelle: "audits", art: "select", bedingungen: [["id", "a1"]] });
  });

  it("meldet, wenn der Datensatz inzwischen gelöscht ist", async () => {
    antworten.lesen = { data: null, error: null };
    await expect(speichereVersioniert("audits", "a1", 3, { titel: "T" })).rejects.toSatisfy(
      (f: unknown) => KonfliktFehler.ist(f) && f.grund === "geloescht",
    );
  });

  it("bleibt beim Rechtefehler, wenn die Version stimmt", async () => {
    antworten.lesen = { data: { version: 3 }, error: null };
    await expect(speichereVersioniert("audits", "a1", 3, { titel: "T" })).rejects.toSatisfy(
      (f: unknown) => !KonfliktFehler.ist(f) && /Recht/.test(String((f as Error).message)),
    );
  });

  it("reicht Fehler der Datenbank weiter", async () => {
    antworten.schreiben = { data: null, error: { message: "violates check constraint" } };
    await expect(speichereVersioniert("audits", "a1", 3, { titel: "T" })).rejects.toThrow(
      "violates check constraint",
    );
  });
});

describe("loescheVersioniert", () => {
  it("löscht nur mit der geladenen Version", async () => {
    antworten.schreiben = { data: [{ id: "p1", version: 2 }], error: null };
    await loescheVersioniert("atr_positionen", "p1", 2);
    expect(aufrufe[0]).toMatchObject({
      tabelle: "atr_positionen",
      art: "delete",
      bedingungen: [["id", "p1"], ["version", 2]],
    });
  });

  it("gilt als erledigt, wenn der Datensatz schon weg ist", async () => {
    // Zwei löschen gleichzeitig: das Ziel ist erreicht, kein Fehler.
    antworten.lesen = { data: null, error: null };
    await expect(loescheVersioniert("atr_positionen", "p1", 2)).resolves.toBeUndefined();
  });

  it("meldet einen Konflikt, wenn der Datensatz inzwischen geändert wurde", async () => {
    antworten.lesen = { data: { version: 3 }, error: null };
    await expect(loescheVersioniert("atr_positionen", "p1", 2)).rejects.toSatisfy(
      (f: unknown) => KonfliktFehler.ist(f) && f.grund === "konflikt",
    );
  });
});

describe("pruefeVersion", () => {
  // Vor dem Löschen von Dateien: erst sicher sein, dass die Zeile noch die
  // geladene ist — sonst wären die Dateien weg und die Zeile bliebe stehen.
  it("lässt weitermachen, solange die Version stimmt", async () => {
    antworten.lesen = { data: { version: 2 }, error: null };
    await expect(pruefeVersion("maschinen", "m1", 2)).resolves.toBeUndefined();
    expect(aufrufe[0]).toMatchObject({ tabelle: "maschinen", art: "select", bedingungen: [["id", "m1"]] });
  });

  it("lässt weitermachen, wenn die Zeile schon weg ist", async () => {
    antworten.lesen = { data: null, error: null };
    await expect(pruefeVersion("maschinen", "m1", 2)).resolves.toBeUndefined();
  });

  it("hält an, wenn jemand anders schneller war", async () => {
    antworten.lesen = { data: { version: 3 }, error: null };
    await expect(pruefeVersion("maschinen", "m1", 2)).rejects.toSatisfy(
      (f: unknown) => KonfliktFehler.ist(f) && f.grund === "konflikt",
    );
  });
});
