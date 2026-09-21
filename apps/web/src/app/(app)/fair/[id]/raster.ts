"use client";

import { pdfjs } from "react-pdf";

import "@/app/(app)/fair/pdf-arbeiter";
import type { ZeichnungsArt } from "@/lib/fair";
import type { Rechteck } from "@/lib/fair/geometrie";

/**
 * Die Zeichnung als Pixel — ein einzelnes markiertes Feld für die OCR. Immer aus
 * der Originaldatei, nie von der Leinwand am Bildschirm: deren Schärfe hinge am
 * Zoom. Die ballonierte Ausgabe entsteht dagegen vektortreu in `ballon-pdf.ts`.
 */

/** Lange Kante eines OCR-Ausschnitts in Pixeln (wie im Altsystem). */
const OCR_KANTE = 1400;

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
