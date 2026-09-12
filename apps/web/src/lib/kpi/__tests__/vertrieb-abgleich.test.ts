/**
 * Vertrieb nach dem Systemvergleich: Kundenanteile (VER-03B), Vergleichsreihe
 * im Umsatzverlauf (VER-04A) und vollständiges Laden der Einzelaufträge
 * (VER-03A, TAB-01).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const aufrufe: { methode: string; args: unknown[] }[] = [];
let bestand: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: (tabelle: string) => {
      aufrufe.push({ methode: "from", args: [tabelle] });
      const kette: Record<string, unknown> = {};
      for (const methode of ["select", "gt", "gte", "lte", "order"]) {
        kette[methode] = (...args: unknown[]) => {
          aufrufe.push({ methode, args });
          return kette;
        };
      }
      kette.range = (von: number, bis: number) => {
        aufrufe.push({ methode: "range", args: [von, bis] });
        return Promise.resolve({ data: bestand.slice(von, bis + 1), error: null });
      };
      return kette;
    },
  }),
}));

import {
  kundenfarben,
  kundensaeulen,
  vergleichsart,
  verlaufMitVergleich,
  vertriebApi,
  zeitachse,
  zeitraumText,
} from "../vertrieb";

const worte = {
  zu: (was: string) => `zum ${was}`,
  quartal: (q: number) => `${q}. Quartal`,
  jahr: (j: number) => `Jahr ${j}`,
};

describe("Kundensäulen", () => {
  const kunden = [
    { kunde: "Diehl", wert: 600, anteil: 0.6 },
    { kunde: "Ethiopian", wert: 200, anteil: 0.2 },
    { kunde: "B/E", wert: 100, anteil: 0.1 },
    { kunde: "Pilatus", wert: 60, anteil: 0.06 },
    { kunde: "ACM", wert: 40, anteil: 0.04 },
  ];

  it("zeigt die sichtbaren Kunden und rechnet den Rest aus dem Gesamt", () => {
    const { saeulen, gesamt, restAnzahl } = kundensaeulen(kunden, 3);
    expect(gesamt).toBe(1000);
    expect(saeulen.map((s) => [s.platz, s.kunde, s.wert])).toEqual([
      [1, "Diehl", 600],
      [2, "Ethiopian", 200],
      [3, "B/E", 100],
      [null, "", 100],
    ]);
    expect(saeulen[3].anteil).toBeCloseTo(0.1);
    expect(restAnzahl).toBe(2);
  });

  it("lässt den Rest weg, wenn alle Kunden sichtbar sind", () => {
    const { saeulen, restAnzahl } = kundensaeulen(kunden, 14);
    expect(saeulen).toHaveLength(5);
    expect(saeulen.every((s) => s.platz !== null)).toBe(true);
    expect(restAnzahl).toBe(0);
  });

  it("zeigt nichts bei leerer oder nicht positiver Grundlage", () => {
    expect(kundensaeulen([], 3).saeulen).toEqual([]);
    expect(kundensaeulen([{ kunde: "X", wert: -5, anteil: 1 }], 3).saeulen).toEqual([]);
  });
});

describe("Kundenfarben", () => {
  it("gibt einem Kunden in beiden Diagrammen dieselbe Farbe", () => {
    const farben = kundenfarben([
      ["Diehl", "Ethiopian", "B/E"],
      ["Diehl", "Pilatus", "ACM"],
    ]);
    expect(farben.get("Diehl")).toBe(0);
    // Solange Farben frei sind, bekommt jeder Kunde eine eigene.
    expect(new Set(["Diehl", "Ethiopian", "B/E", "Pilatus", "ACM"].map((k) => farben.get(k))).size).toBe(5);
  });

  it("vergibt eine Farbe erst dann doppelt, wenn beide Kunden nie im selben Diagramm stehen", () => {
    const a = ["A1", "A2", "A3", "A4", "A5"];
    const b = ["B1", "B2", "B3", "B4", "B5"];
    const farben = kundenfarben([a, b], 8);
    for (const liste of [a, b]) {
      const belegt = liste.map((k) => farben.get(k)).filter((f) => f !== undefined);
      expect(new Set(belegt).size).toBe(belegt.length);
    }
    expect(farben.get("B5")).toBeDefined();
  });

  it("lässt Kunden ohne freie Farbe neutral", () => {
    const liste = Array.from({ length: 10 }, (_, i) => `K${i + 1}`);
    const farben = kundenfarben([liste], 8);
    expect(farben.get("K8")).toBe(7);
    expect(farben.get("K9")).toBeUndefined();
  });
});

describe("Vergleichsreihe im Umsatzverlauf", () => {
  it("wählt die Vergleichsreihe wie das Altsystem, beim freien Zeitraum das Vorjahr", () => {
    expect(vergleichsart("monat")).toBe("vorperiode");
    expect(vergleichsart("quartal")).toBe("vorperiode");
    expect(vergleichsart("jahr")).toBe("vorjahr");
    expect(vergleichsart("frei")).toBe("vorjahr");
    expect(vergleichsart("alles")).toBeNull();
  });

  it("baut die Achse wie date_trunc", () => {
    expect(zeitachse("2026-09-01", "2026-09-03", "day")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    // Der 1. Juli 2026 ist ein Mittwoch; die Woche beginnt am Montag davor.
    expect(zeitachse("2026-07-01", "2026-07-15", "week")).toEqual(["2026-06-29", "2026-07-06", "2026-07-13"]);
    expect(zeitachse("2025-11-15", "2026-02-02", "month")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("legt das Vorjahr Bucket für Bucket daneben und lässt Lücken leer statt null Euro", () => {
    const zeilen = verlaufMitVergleich(
      [
        { bucket: "2026-01-01", umsatz: 100 },
        { bucket: "2026-03-01", umsatz: 300 },
      ],
      [
        { bucket: "2025-01-01", umsatz: 50 },
        { bucket: "2025-02-01", umsatz: 60 },
      ],
      { von: "2026-01-01", bis: "2026-03-10" },
      { von: "2025-01-01", bis: "2025-03-10" },
      "month",
    );
    expect(zeilen).toEqual([
      { bucket: "2026-01-01", umsatz: 100, vorher: 50, bucketVorher: "2025-01-01" },
      { bucket: "2026-02-01", umsatz: null, vorher: 60, bucketVorher: "2025-02-01" },
      { bucket: "2026-03-01", umsatz: 300, vorher: null, bucketVorher: "2025-03-01" },
    ]);
  });

  it("führt überzählige Tage ohne Vergleichstag", () => {
    const zeilen = verlaufMitVergleich(
      [{ bucket: "2026-03-31", umsatz: 10 }],
      [],
      { von: "2026-03-01", bis: "2026-03-31" },
      { von: "2026-02-01", bis: "2026-02-28" },
      "day",
    );
    expect(zeilen).toHaveLength(31);
    expect(zeilen[27]).toMatchObject({ bucket: "2026-03-28", bucketVorher: "2026-02-28" });
    expect(zeilen[30]).toEqual({ bucket: "2026-03-31", umsatz: 10, vorher: null, bucketVorher: null });
  });

  it("zeigt bei „Alles“ nur die aktuelle Reihe über den ganzen Bestand", () => {
    const zeilen = verlaufMitVergleich(
      [
        { bucket: "2025-11-01", umsatz: 1 },
        { bucket: "2026-01-01", umsatz: 3 },
      ],
      null,
      null,
      null,
      "month",
    );
    expect(zeilen).toEqual([
      { bucket: "2025-11-01", umsatz: 1 },
      { bucket: "2025-12-01", umsatz: null },
      { bucket: "2026-01-01", umsatz: 3 },
    ]);
  });

  it("nennt den konkreten Zeitraum der Reihe", () => {
    expect(zeitraumText("jahr", { von: "2025-01-01", bis: "2025-09-12" }, "de-DE", worte)).toBe("2025");
    expect(zeitraumText("monat", { von: "2026-08-01", bis: "2026-08-12" }, "de-DE", worte)).toBe("August 2026");
    expect(zeitraumText("quartal", { von: "2026-04-01", bis: "2026-06-12" }, "de-DE", worte)).toBe("2. Quartal 2026");
    expect(zeitraumText("frei", { von: "2025-03-01", bis: "2025-04-30" }, "de-DE", worte)).toBe(
      "01.03.2025–30.04.2025",
    );
  });
});

describe("Einzelaufträge laden", () => {
  beforeEach(() => {
    aufrufe.length = 0;
  });

  it("lädt über das PostgREST-Maximum hinaus seitenweise alles", async () => {
    bestand = Array.from({ length: 1005 }, (_, i) => ({
      vorgang_nr: String(i),
      customer_name: "K",
      datum: "2026-01-01",
      wert_eur: 1,
    }));
    const zeilen = await vertriebApi.einzelauftraege("2026-01-01", "2026-09-12");
    expect(zeilen).toHaveLength(1005);
    expect(aufrufe.filter((a) => a.methode === "range").map((a) => a.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // Dieselbe Menge wie die Kachel „Aufträge gesamt“.
    expect(aufrufe).toContainEqual({ methode: "gt", args: ["wert_eur", 0] });
    expect(aufrufe).toContainEqual({ methode: "gte", args: ["datum", "2026-01-01"] });
    expect(aufrufe).toContainEqual({ methode: "lte", args: ["datum", "2026-09-12"] });
  });

  it("setzt bei „Alles“ keine Datumsgrenze", async () => {
    bestand = [{ vorgang_nr: "1", customer_name: null, datum: "2025-01-02", wert_eur: "12.50" }];
    const zeilen = await vertriebApi.einzelauftraege(null, null);
    expect(zeilen).toEqual([{ vorgang_nr: "1", customer_name: null, datum: "2025-01-02", wert_eur: 12.5 }]);
    expect(aufrufe.some((a) => a.methode === "gte" || a.methode === "lte")).toBe(false);
  });
});
