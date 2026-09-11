import { describe, expect, it } from "vitest";

import { TITEL } from "@/lib/brotkrumen";
import { SPRACHEN, SPRACHE_LABEL, SPRACHE_TAG, VORGABE, spracheAus } from "@/lib/sprache";
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
    expect(SPRACHE_TAG[s]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
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

  it("setzt den Namen der App in die Absage ein", () => {
    for (const s of SPRACHEN) {
      expect(texteFuer(s).start.verweigert("ATR")).toContain("ATR");
    }
  });
});
