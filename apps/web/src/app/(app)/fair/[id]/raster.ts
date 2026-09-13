"use client";

import { pdfjs } from "react-pdf";

import "@/app/(app)/fair/pdf-arbeiter";
import type { Drehung, ZeichnungsArt } from "@/lib/fair";
import type { Rechteck } from "@/lib/fair/geometrie";
import { drehe } from "@/lib/fair/leinwand";

/**
 * Die Zeichnung als Pixel — für OCR ein einzelnes Feld, für das PDF ganze
 * Seiten. Immer aus der Originaldatei, nie von der Leinwand am Bildschirm:
 * deren Schärfe hinge am Zoom.
 */

/** Lange Kante eines OCR-Ausschnitts in Pixeln (wie im Altsystem). */
const OCR_KANTE = 1400;
/** Lange Kante einer Seite im PDF — scharf genug für Maßtext, klein genug für
 *  den Speicher. */
const PDF_KANTE = 3000;

function ladeBild(url: string): Promise<HTMLImageElement> {
  return new Promise((fertig, fehler) => {
    const img = new Image();
    // Sonst gilt die Leinwand als fremd, und OCR darf ihre Pixel nicht lesen.
    img.crossOrigin = "anonymous";
    img.onload = () => fertig(img);
    img.onerror = () => fehler(new Error("Bild ließ sich nicht laden"));
    img.src = url;
  });
}

function leinwand(breite: number, hoehe: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(breite));
  c.height = Math.max(1, Math.ceil(hoehe));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Keine 2D-Leinwand");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
}

/** Das markierte Feld, so vergrößert, dass seine lange Kante `OCR_KANTE` erreicht. */
export async function feldAlsLeinwand(
  url: string,
  art: ZeichnungsArt,
  seite: number,
  bereich: Rechteck,
): Promise<HTMLCanvasElement> {
  if (art === "bild") {
    const img = await ladeBild(url);
    const b = Math.max(1, bereich.b * img.naturalWidth);
    const h = Math.max(1, bereich.h * img.naturalHeight);
    // Ein Rasterbild gewinnt durch Vergrößern nichts; höchstens vierfach.
    const k = Math.min(4, Math.max(1, OCR_KANTE / Math.max(b, h)));
    const { c, ctx } = leinwand(b * k, h * k);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, bereich.x * img.naturalWidth, bereich.y * img.naturalHeight, b, h, 0, 0, c.width, c.height);
    return c;
  }

  const pdf = await pdfjs.getDocument({ url }).promise;
  try {
    const page = await pdf.getPage(seite);
    const basis = page.getViewport({ scale: 1 });
    const b = Math.max(1, bereich.b * basis.width);
    const h = Math.max(1, bereich.h * basis.height);
    // Vektor: beliebig scharf, aber die Leinwand bleibt unter 4096 px.
    const k = Math.min(Math.max(1, OCR_KANTE / Math.max(b, h)), 4096 / Math.max(b, h));
    const { c, ctx } = leinwand(b * k, h * k);
    const viewport = page.getViewport({
      scale: k,
      offsetX: -bereich.x * basis.width * k,
      offsetY: -bereich.y * basis.height * k,
    });
    await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
    return c;
  } finally {
    await pdf.destroy();
  }
}

/** Alle Seiten als JPEG, gedreht wie die Ansicht; Maße kanonisch in
 *  Seiteneinheiten, wie die Ballons sie brauchen. */
export async function seitenAlsBilder(
  url: string,
  art: ZeichnungsArt,
  drehung: Drehung,
): Promise<{ bild: string; breite: number; hoehe: number }[]> {
  const alsBild = (c: HTMLCanvasElement) => drehe(c, drehung).toDataURL("image/jpeg", 0.92);

  if (art === "bild") {
    const img = await ladeBild(url);
    const k = Math.min(1, PDF_KANTE / Math.max(img.naturalWidth, img.naturalHeight));
    const { c, ctx } = leinwand(img.naturalWidth * k, img.naturalHeight * k);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return [{ bild: alsBild(c), breite: img.naturalWidth, hoehe: img.naturalHeight }];
  }

  const pdf = await pdfjs.getDocument({ url }).promise;
  try {
    const seiten = [];
    for (let nr = 1; nr <= pdf.numPages; nr++) {
      const page = await pdf.getPage(nr);
      const basis = page.getViewport({ scale: 1 });
      const k = PDF_KANTE / Math.max(basis.width, basis.height);
      const viewport = page.getViewport({ scale: k });
      const { c, ctx } = leinwand(viewport.width, viewport.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
      seiten.push({ bild: alsBild(c), breite: basis.width, hoehe: basis.height });
    }
    return seiten;
  } finally {
    await pdf.destroy();
  }
}
