import { jsPDF } from "jspdf";

import type { Ballon } from "@/lib/fair";

/**
 * Die Prüfliste als PDF (FAI-02) — Projektkopf und Tabelle `Nr | Seite | Wert`.
 *
 * Sie wird der ballonierten Zeichnung hinten angefügt, damit das PDF für sich
 * allein als Prüfbericht taugt. Die Zeichnungsseiten selbst entstehen
 * vektortreu in `ballon-pdf.ts` (pdf-lib); hier geht es nur um die Liste. Ohne
 * DOM, damit sie sich prüfen lässt.
 */

export interface PrueflisteEingabe {
  name: string;
  /** Beschriftung und Wert des Projektkopfs, in Anzeigereihenfolge. */
  kopf: [string, string | null][];
  spalten: { nr: string; seite: string; wert: string };
  pruefliste: string;
  ballons: readonly Ballon[];
}

const RAND = 48;
const A4 = { b: 595.28, h: 841.89 };

function pruefliste(doc: jsPDF, e: PrueflisteEingabe) {
  const spalteSeite = RAND + 50;
  const spalteWert = RAND + 110;
  const breiteWert = A4.b - RAND - spalteWert;
  let y = RAND;

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(e.name, RAND, y, { baseline: "top" });
  y += 30;

  doc.setFontSize(10);
  for (const [titel, wert] of e.kopf) {
    doc.setFont("helvetica", "bold");
    doc.text(titel, RAND, y, { baseline: "top" });
    doc.setFont("helvetica", "normal");
    doc.text(wert || "—", RAND + 80, y, { baseline: "top" });
    y += 15;
  }
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(e.pruefliste, RAND, y, { baseline: "top" });
  y += 22;

  const tabellenkopf = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(e.spalten.nr, RAND, y, { baseline: "top" });
    doc.text(e.spalten.seite, spalteSeite, y, { baseline: "top" });
    doc.text(e.spalten.wert, spalteWert, y, { baseline: "top" });
    y += 14;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(RAND, y, A4.b - RAND, y);
    y += 5;
    doc.setFont("helvetica", "normal");
  };
  tabellenkopf();

  for (const b of [...e.ballons].sort((a, c) => a.nummer - c.nummer)) {
    const zeilen: string[] = doc.splitTextToSize(b.wert || "—", breiteWert);
    const hoehe = zeilen.length * 13 + 3;
    if (y + hoehe > A4.h - RAND) {
      doc.addPage("a4", "portrait");
      y = RAND;
      tabellenkopf();
    }
    doc.text(String(b.nummer), RAND, y, { baseline: "top" });
    doc.text(String(b.seite), spalteSeite, y, { baseline: "top" });
    doc.text(zeilen, spalteWert, y, { baseline: "top" });
    y += hoehe;
  }
}

/** Die Prüfliste als eigenständiges A4-PDF (Hochformat). */
export function prueflistePdf(e: PrueflisteEingabe): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  pruefliste(doc, e);
  return doc;
}
