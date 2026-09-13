import { jsPDF } from "jspdf";

import type { Ballon, Drehung } from "@/lib/fair";
import { ballonPixel, gedrehteMasse, inDrehung } from "@/lib/fair/geometrie";

/**
 * PDF der ballonierten Zeichnung (FAI-02).
 *
 * Das Altsystem (`fairExport.ts`, Knopf „PDF exportieren“) gibt die Zeichnung
 * mit Ballons aus, jede Seite in ihrer Größe und mit der Drehung der Ansicht.
 * Das bleibt so. Dazu kommt hier die Prüfliste mit Projektkopf, damit das PDF
 * für sich allein als Prüfbericht taugt.
 *
 * Die Seiten kommen als fertige Bilder herein (gerastert von `raster.ts`); die
 * Ballons zeichnet diese Funktion als Vektoren mit derselben Rechnung wie am
 * Bildschirm (`ballonPixel`) und derselben Bubblegröße. Ohne DOM, damit sie
 * sich prüfen lässt.
 */

export interface PdfEingabe {
  name: string;
  /** Beschriftung und Wert des Projektkopfs, in Anzeigereihenfolge. */
  kopf: [string, string | null][];
  spalten: { nr: string; seite: string; wert: string };
  pruefliste: string;
  /** Bild schon gedreht; Maße kanonisch in Seiteneinheiten. */
  seiten: { bild: string; breite: number; hoehe: number }[];
  ballons: readonly Ballon[];
  drehung: Drehung;
  groesse: number;
}

const ROT: [number, number, number] = [220, 38, 38];
const RAND = 48;
const A4 = { b: 595.28, h: 841.89 };

function lage(b: number, h: number): "portrait" | "landscape" {
  return b > h ? "landscape" : "portrait";
}

function zeichneBallon(doc: jsPDF, b: Ballon, breite: number, hoehe: number, drehung: Drehung, groesse: number) {
  const p = ballonPixel(b, breite, hoehe, groesse);
  const g = (x: number, y: number) => inDrehung(x, y, breite, hoehe, drehung);
  const strich = Math.max(1, p.r * 0.14);

  const e1 = g(p.bereich.x, p.bereich.y);
  const e2 = g(p.bereich.x + p.bereich.b, p.bereich.y + p.bereich.h);
  doc.setDrawColor(...ROT);
  doc.setLineWidth(strich / 2);
  doc.rect(Math.min(e1.x, e2.x), Math.min(e1.y, e2.y), Math.abs(e2.x - e1.x), Math.abs(e2.y - e1.y), "S");

  const [k1, k2, k3] = p.keilPunkte.split(" ").map((punkt) => {
    const [x, y] = punkt.split(",").map(Number);
    return g(x, y);
  });
  doc.setFillColor(...ROT);
  doc.triangle(k1.x, k1.y, k2.x, k2.y, k3.x, k3.y, "F");

  // Die Nummer steht in jeder Lage aufrecht: gedreht wird nur ihr Ort.
  const m = g(p.blase.x, p.blase.y);
  doc.setLineWidth(strich);
  doc.setFillColor(255, 255, 255);
  doc.circle(m.x, m.y, p.r, "FD");
  doc.setTextColor(...ROT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(p.schriftgroesse);
  doc.text(String(b.nummer), m.x, m.y, { align: "center", baseline: "middle" });
}

function pruefliste(doc: jsPDF, e: PdfEingabe) {
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

export function pruefberichtPdf(e: PdfEingabe): jsPDF {
  const sichten = e.seiten.map((s) => gedrehteMasse(s.breite, s.hoehe, e.drehung));
  const erste = sichten[0] ?? A4;
  const doc = new jsPDF({ unit: "pt", format: [erste.b, erste.h], orientation: lage(erste.b, erste.h) });

  e.seiten.forEach((s, i) => {
    const sicht = sichten[i];
    if (i > 0) doc.addPage([sicht.b, sicht.h], lage(sicht.b, sicht.h));
    doc.addImage(s.bild, s.bild.startsWith("data:image/png") ? "PNG" : "JPEG", 0, 0, sicht.b, sicht.h);
    for (const b of e.ballons) {
      if (b.seite === i + 1) zeichneBallon(doc, b, s.breite, s.hoehe, e.drehung, e.groesse);
    }
  });

  if (e.seiten.length > 0) doc.addPage("a4", "portrait");
  pruefliste(doc, e);
  return doc;
}
