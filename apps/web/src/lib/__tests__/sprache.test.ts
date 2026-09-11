import { describe, expect, it } from "vitest";

import { LANGER_NAME, TITEL } from "@/lib/brotkrumen";
import {
  SPRACHEN,
  SPRACHE_LABEL,
  SPRACHE_TAG,
  VORGABE,
  ZAHL_TAG,
  spracheAus,
} from "@/lib/sprache";
import { WOERTERBUCH, texteFuer } from "@/texte";

describe("spracheAus", () => {
  it("nimmt eine bekannte Sprache", () => {
    expect(spracheAus("en")).toBe("en");
  });

  it("fällt auf Deutsch zurück", () => {
    // Der Wert kommt aus einem Cookie: er kann alles sein.
    expect(spracheAus(undefined)).toBe(VORGABE);
    expect(spracheAus("")).toBe(VORGABE);
    expect(spracheAus("klingonisch")).toBe(VORGABE);
    expect(spracheAus("../../etc/passwd")).toBe(VORGABE);
  });
});

describe("Wörterbücher", () => {
  it.each(SPRACHEN)("%s ist vollständig angemeldet", (s) => {
    expect(WOERTERBUCH[s]).toBeTruthy();
    expect(SPRACHE_LABEL[s]).toBeTruthy();
    expect(SPRACHE_TAG[s]).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    // Das Rechen-Kürzel darf ein Unicode-Anhängsel tragen (`-u-nu-latn`),
    // muss aber dieselbe Sprache meinen.
    expect(ZAHL_TAG[s].startsWith(s)).toBe(true);
  });

  it.each(SPRACHEN)("%s benennt jede Seite des Pfades", (s) => {
    // Der Typ erzwingt das schon beim Übersetzen; hier steht, warum: eine
    // fehlende Seite wäre eine leere Krume, und die sagt niemandem etwas.
    const seiten = texteFuer(s).pfad.seiten as Record<string, string>;
    for (const adresse of Object.keys(TITEL)) {
      expect(seiten[adresse], adresse).toBeTruthy();
    }
  });

  it("übersetzt die Zahlen in der Kopfzeile mit ihrer Zahl", () => {
    for (const s of SPRACHEN) {
      const t = texteFuer(s);
      expect(t.kopf.meldungen(3)).toContain("3");
      expect(t.kopf.massnahmen(5, 2)).toContain("5");
      expect(t.kopf.massnahmen(5, 2)).toContain("2");
      // Ohne Überfällige darf die zweite Zahl nicht auftauchen.
      expect(t.kopf.massnahmen(5, 0)).not.toContain("0");
    }
  });

  it("sagt in jeder Fremdsprache, dass die Hilfe deutsch bleibt", () => {
    // Im Deutschen steht dort nichts — der Satz wäre eine Selbstverständlichkeit.
    // In jeder anderen Sprache muss er stehen, sonst klickt jemand auf die
    // Hilfe und findet ohne Vorwarnung Deutsch vor.
    for (const s of SPRACHEN) {
      const satz = texteFuer(s).hilfe.nurDeutsch;
      if (s === VORGABE) expect(satz).toBe("");
      else expect(satz, s).toBeTruthy();
    }
  });

  it("setzt den Namen der App in die Absage ein", () => {
    for (const s of SPRACHEN) {
      expect(texteFuer(s).start.verweigert("ATR")).toContain("ATR");
    }
  });
});

describe("Titel in der Kopfzeile", () => {
  // Fünf Seiten heißen ausgeschrieben anders als ihre Krume. Steht der
  // Schlüssel nicht im Wörterbuch, bliebe die Kopfzeile leer — und zwar
  // lautlos.
  it.each(SPRACHEN)("%s kennt jeden langen Namen", (s) => {
    const namen = texteFuer(s).kopftitel as Record<string, string>;
    for (const schluessel of Object.values(LANGER_NAME)) {
      expect(namen[schluessel], schluessel).toBeTruthy();
    }
  });

  it("nennt nur Adressen, die es gibt", () => {
    const bekannt = new Set([...Object.keys(TITEL), "/"]);
    expect(Object.keys(LANGER_NAME).filter((p) => !bekannt.has(p))).toEqual([]);
  });
});
