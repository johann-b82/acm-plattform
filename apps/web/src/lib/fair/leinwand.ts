import type { Drehung } from "@/lib/fair";

/**
 * Kleine Leinwand-Helfer für OCR und PDF, aus dem Altsystem
 * (`cropRegion.ts`) übernommen.
 */

/** Weißer Rand ringsum — Tesseract liest Text mit Abstand zum Rand deutlich
 *  zuverlässiger als Text, der an die Kante stößt. */
export function mitRand(quelle: HTMLCanvasElement, rand?: number): HTMLCanvasElement {
  const r = rand ?? Math.max(14, Math.round(Math.min(quelle.width, quelle.height) * 0.12));
  const aus = document.createElement("canvas");
  aus.width = quelle.width + 2 * r;
  aus.height = quelle.height + 2 * r;
  const ctx = aus.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, aus.width, aus.height);
    ctx.drawImage(quelle, r, r);
  }
  return aus;
}

/** Kopie, im Uhrzeigersinn um `d` gedreht. */
export function drehe(quelle: HTMLCanvasElement, d: Drehung): HTMLCanvasElement {
  if (d === 0) return quelle;
  const quer = d === 90 || d === 270;
  const aus = document.createElement("canvas");
  aus.width = quer ? quelle.height : quelle.width;
  aus.height = quer ? quelle.width : quelle.height;
  const ctx = aus.getContext("2d");
  if (ctx) {
    ctx.translate(aus.width / 2, aus.height / 2);
    ctx.rotate((d * Math.PI) / 180);
    ctx.drawImage(quelle, -quelle.width / 2, -quelle.height / 2);
  }
  return aus;
}
