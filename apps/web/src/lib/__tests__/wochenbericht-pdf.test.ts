/**
 * Der Wochenbericht als PDF (HR-06).
 *
 * Wie im Altsystem A4 quer. Anders als dort kein Bildschirmfoto der Seite:
 * das PDF wird aus denselben Zeilen gesetzt, die die Seite zeigt — mit Text,
 * der sich durchsuchen lässt, und einer Tabelle, die an Seitenenden sauber
 * umbricht und ihren Kopf wiederholt. Ein Bildschirmfoto schneidet eine lange
 * Tabelle mitten durch eine Zeile.
 */
import { describe, expect, it } from "vitest";

import type { WochenZeile } from "@/lib/kpi/personal";
import { pdfTexte, wochenberichtPdf } from "@/lib/kpi/wochenbericht-pdf";
import { de } from "@/texte/de";
import { en } from "@/texte/en";
import { uk } from "@/texte/uk";
import { vi } from "@/texte/vi";

function zeilen(anzahl: number): WochenZeile[] {
  return Array.from({ length: anzahl }, (_, i) => ({
    employee_id: i + 1,
    name: `Person ${i + 1}`,
    ist_stunden: 40,
    soll_stunden: 38,
    netto: i % 3 === 0 ? 2 : -1,
    krank_tage: i === 5 ? 2 : 0,
    krank_stunden: i === 5 ? 16 : 0,
  }));
}

const ERSTELLT = new Date(2026, 8, 12, 10, 30);

async function pdf(anzahl: number, einheit: "tage" | "stunden" = "stunden", texte = de) {
  return wochenberichtPdf(
    { jahr: 2026, woche: 37, einheit, zeilen: zeilen(anzahl), erstellt: ERSTELLT },
    texte,
    "de-DE",
  );
}

describe("Wochenbericht als PDF", () => {
  it("ist A4 quer", async () => {
    const dok = await pdf(3);
    expect(Math.round(dok.internal.pageSize.getWidth())).toBe(297);
    expect(Math.round(dok.internal.pageSize.getHeight())).toBe(210);
  });

  it("nennt Woche, Kacheln und beide Diagramme", async () => {
    const text = (await pdf(3)).output();
    expect(text).toContain("KW 37 / 2026");
    expect(text).toContain("Saldo Mehrarbeit");
    expect(text).toContain("Mehrarbeit je Person");
    expect(text).toContain("Krankheit je Person");
  });

  it("führt jede Person der Woche in der Tabelle", async () => {
    const text = (await pdf(60)).output();
    for (let i = 1; i <= 60; i++) expect(text).toContain(`(Person ${i})`);
  });

  it("bricht eine lange Tabelle auf Folgeseiten um und wiederholt den Kopf", async () => {
    const dok = await pdf(60);
    const seiten = dok.getNumberOfPages();
    expect(seiten).toBeGreaterThan(1);
    const koepfe = dok.output().match(/\(Soll\) Tj/g) ?? [];
    expect(koepfe.length).toBe(seiten);
  });

  it("rechnet den Saldo aus allen Zeilen", async () => {
    // 20 Personen mit +2, 40 mit −1: zusammen null.
    expect((await pdf(60)).output()).toContain("(0,00 Std.)");
    // Vier Personen: zweimal +2, zweimal −1.
    expect((await pdf(4)).output()).toContain("(+2,00 Std.)");
  });

  it("folgt der gewählten Einheit der Krankheit", async () => {
    expect((await pdf(10, "tage")).output()).toContain("(2,00 Tage)");
    expect((await pdf(10, "stunden")).output()).toContain("(16,00 Std.)");
  });

  it("sagt es, wenn ein Diagramm nichts zu zeigen hat", async () => {
    const text = (await pdf(2)).output();
    // Person 1 hat +2, Person 2 −1; niemand ist krank.
    expect(text).toContain(`(${de.wochenbericht.keineWerte})`);
  });
});

describe("Sprache im PDF", () => {
  it("nimmt die gewählte Sprache, wenn die PDF-Grundschrift sie darstellen kann", () => {
    expect(pdfTexte(en)).toBe(en);
    expect(pdfTexte(de)).toBe(de);
  });

  it("fällt auf Deutsch zurück, wenn die Grundschrift die Zeichen nicht hat", () => {
    // Kyrillisch und vietnamesische Zeichen stünden sonst als Zeichensalat da.
    expect(pdfTexte(uk)).toBe(de);
    expect(pdfTexte(vi)).toBe(de);
  });
});
