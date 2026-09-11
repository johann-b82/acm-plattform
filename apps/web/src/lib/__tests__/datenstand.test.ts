import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ART_LABEL,
  QUELLEN,
  aeltester,
  alterText,
  staende,
  type Standzeile,
} from "@/lib/datenstand";

const ZEILEN: Standzeile[] = [
  { art: "umsatz", zuletzt: "2026-09-09T11:46:44Z", laeufe: 2 },
  { art: "auftraege", zuletzt: "2026-09-10T09:54:22Z", laeufe: 2 },
  { art: "angebote", zuletzt: "2026-09-10T09:54:16Z", laeufe: 1 },
  { art: "interessenten", zuletzt: "2026-09-10T09:54:19Z", laeufe: 1 },
  { art: "kontakte", zuletzt: "2026-09-10T09:53:59Z", laeufe: 1 },
];

describe("staende", () => {
  it("nennt die Quellen des Bereichs, älteste zuerst", () => {
    const s = staende("vertrieb", ZEILEN);
    expect(s).toHaveLength(5);
    expect(s[0].art).toBe("umsatz");
    expect(s[4].art).toBe("auftraege");
  });

  it("stellt eine nie hochgeladene Art ganz nach vorn", () => {
    // Nichts ist älter als nie — und genau das soll man zuerst sehen.
    const s = staende("vertrieb", ZEILEN.filter((z) => z.art !== "kontakte"));
    expect(s[0].art).toBe("kontakte");
    expect(s[0].zuletzt).toBeNull();
  });

  it("nimmt fremde Arten nicht mit", () => {
    // Ein Umsatzauszug macht die Qualitätszahlen nicht frischer.
    expect(staende("qualitaet", ZEILEN).map((s) => s.art)).not.toContain("umsatz");
  });

  it("kommt mit noch nicht geladenen Daten zurecht", () => {
    expect(staende("vertrieb", undefined).every((s) => s.zuletzt === null)).toBe(true);
  });

  it("schweigt zu einem Bereich, den es nicht gibt", () => {
    expect(staende("gibtesnicht", ZEILEN)).toEqual([]);
  });
});

describe("aeltester", () => {
  it("ist der Stand, der die Seite bestimmt", () => {
    expect(aeltester(staende("vertrieb", ZEILEN))).toBe("2026-09-09T11:46:44Z");
  });

  it("ist null, sobald eine Quelle fehlt", () => {
    expect(aeltester(staende("vertrieb", []))).toBeNull();
  });
});

describe("alterText", () => {
  const jetzt = new Date(2026, 8, 11, 9, 0); // 11.09.2026, 09:00 Ortszeit

  it("zählt Kalendertage, nicht Stunden", () => {
    // Gestern Abend ist gestern, auch wenn es zehn Stunden her ist.
    expect(alterText(new Date(2026, 8, 10, 23, 0).toISOString(), jetzt)).toBe("gestern");
  });

  it("nennt heute heute", () => {
    expect(alterText(new Date(2026, 8, 11, 1, 0).toISOString(), jetzt)).toBe("heute");
  });

  it("zählt darüber in Tagen", () => {
    expect(alterText(new Date(2026, 8, 6, 12, 0).toISOString(), jetzt)).toBe("vor 5 Tagen");
  });

  it("nennt einen Zeitpunkt in der Zukunft nicht „vor -1 Tagen“", () => {
    expect(alterText(new Date(2026, 8, 12, 8, 0).toISOString(), jetzt)).toBe("heute");
  });
});

describe("Zuordnung", () => {
  it("gibt jeder Quelle einen Namen", () => {
    for (const arten of Object.values(QUELLEN)) {
      for (const art of arten) expect(ART_LABEL[art]).toBeTruthy();
    }
  });
});

describe("Abgleich mit compute", () => {
  // Die Namen der Dateiarten werden in `uploads.py` vergeben und landen als
  // `kind` in der Datenbank. Wird dort einer umbenannt, stünde hier lautlos
  // „Datenstand unvollständig" — die Art käme nie zurück.
  const quelle = readFileSync(
    path.resolve(__dirname, "../../../../../services/compute/app/routers/uploads.py"),
    "utf8",
  );
  const block = quelle.slice(quelle.indexOf("ARTEN = ("), quelle.indexOf(")", quelle.indexOf("ARTEN = (")));
  const arten = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  it("findet die Liste überhaupt", () => {
    expect(arten.length).toBeGreaterThan(10);
  });

  it.each([...new Set(Object.values(QUELLEN).flat())])("compute kennt %s", (art) => {
    expect(arten).toContain(art);
  });
});
