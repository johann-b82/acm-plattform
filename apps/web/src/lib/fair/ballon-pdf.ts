import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFEmbeddedPage, PDFFont, PDFPage } from "pdf-lib";

import type { Ballon, Drehung, ZeichnungsArt } from "@/lib/fair";
import { ballonPixel } from "@/lib/fair/geometrie";

/**
 * Die ballonierte Zeichnung als PDF in **voller Originalqualität** (FAI-02).
 *
 * Wie im Altsystem (`fairExport.ts`): eine PDF-Seite wird als **Vektor**-XObject
 * eingebettet und aufrecht auf eine neue Seite gelegt, deren Größe der
 * gedrehten Ansicht des Editors entspricht — keine Neurasterung, kein
 * Verkleinern. Ein Bild kommt mit seinen Originalbytes in nativer Auflösung
 * hinein. Die Ballons liegen als scharfe Vektoren darüber; die Ansichtdrehung
 * dreht die ganze Seite, die Nummern werden gegengedreht und bleiben aufrecht.
 *
 * Die Prüfliste (Projektkopf + Tabelle) bleibt in jsPDF (`pdf.ts`) und wird mit
 * `haengePdfAn` hinten angefügt.
 */

const ROT = rgb(0.862, 0.149, 0.149); // #dc2626
const WEISS = rgb(1, 1, 1);
/** Das markierte Feld halbtransparent, wie im Altsystem. */
const FELD_DECKKRAFT = 0.45;

export interface BallonPdfEingabe {
  /** Die Originalbytes der Zeichnung (PDF oder Bild). */
  quelle: ArrayBuffer;
  art: ZeichnungsArt;
  ballons: readonly Ballon[];
  drehung: Drehung;
  groesse: number;
}

/**
 * Eine eingebettete Quellseite (unrotierter Inhalt, W0×H0) **aufrecht** auf die
 * Zielseite legen und die Quell-`/Rotate` (im Uhrzeigersinn) rückgängig machen.
 * Die Zielseite ist auf die drehungsbewussten Maße gesetzt, damit das Ergebnis
 * zu pdf.js/dem Editor passt.
 */
function aufrecht(seite: PDFPage, eingebettet: PDFEmbeddedPage, rot: number, W0: number, H0: number): void {
  switch (rot) {
    case 90:
      seite.drawPage(eingebettet, { x: 0, y: W0, rotate: degrees(-90) });
      break;
    case 180:
      seite.drawPage(eingebettet, { x: W0, y: H0, rotate: degrees(180) });
      break;
    case 270:
      seite.drawPage(eingebettet, { x: H0, y: 0, rotate: degrees(90) });
      break;
    default:
      seite.drawPage(eingebettet, { x: 0, y: 0 });
  }
}

/**
 * Die Ballons einer Seite im (aufrechten) Seitenraum zeichnen. Die Geometrie aus
 * `ballonPixel` ist Leinwand (y nach unten), pdf-lib rechnet y nach oben — daher
 * das Spiegeln. Die Nummer sitzt mittig auf der Blase und wird um `drehung`
 * gegengedreht, damit sie nach dem Drehen der Seite aufrecht steht.
 */
function zeichneBallons(
  seite: PDFPage,
  font: PDFFont,
  ballons: readonly Ballon[],
  breite: number,
  hoehe: number,
  groesse: number,
  drehung: Drehung,
): void {
  const spiegleY = (y: number) => hoehe - y;
  for (const b of ballons) {
    const p = ballonPixel(b, breite, hoehe, groesse);
    const strich = Math.max(1, p.r * 0.14);

    const { x, y, b: rw, h: rh } = p.bereich;
    seite.drawSvgPath(`M ${x} ${y} L ${x + rw} ${y} L ${x + rw} ${y + rh} L ${x} ${y + rh} Z`, {
      x: 0,
      y: hoehe,
      borderColor: ROT,
      borderWidth: strich,
      borderOpacity: FELD_DECKKRAFT,
    });

    const k = p.keilPunkte.split(" ").map((pt) => pt.split(",").map(Number));
    seite.drawSvgPath(`M ${k[0][0]} ${k[0][1]} L ${k[1][0]} ${k[1][1]} L ${k[2][0]} ${k[2][1]} Z`, {
      x: 0,
      y: hoehe,
      color: ROT,
    });

    seite.drawCircle({
      x: p.blase.x,
      y: spiegleY(p.blase.y),
      size: p.r,
      color: WEISS,
      borderColor: ROT,
      borderWidth: strich,
    });

    const text = String(b.nummer);
    const tw = font.widthOfTextAtSize(text, p.schriftgroesse);
    const bo = p.schriftgroesse * 0.35;
    const cx = p.blase.x;
    const cy = spiegleY(p.blase.y);
    const phi = (drehung * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    seite.drawText(text, {
      x: cx - (tw / 2) * cos + bo * sin,
      y: cy - (tw / 2) * sin - bo * cos,
      size: p.schriftgroesse,
      font,
      color: ROT,
      rotate: degrees(drehung),
    });
  }
}

/** Baut das PDF der ballonierten Zeichnung (ohne Prüfliste). */
export async function ballonierteZeichnung(e: BallonPdfEingabe): Promise<PDFDocument> {
  const aus = await PDFDocument.create();
  const font = await aus.embedFont(StandardFonts.HelveticaBold);

  if (e.art === "bild") {
    const bytes = new Uint8Array(e.quelle);
    const istPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const bild = istPng ? await aus.embedPng(bytes) : await aus.embedJpg(bytes);
    const seite = aus.addPage([bild.width, bild.height]);
    seite.drawImage(bild, { x: 0, y: 0, width: bild.width, height: bild.height });
    zeichneBallons(seite, font, e.ballons, bild.width, bild.height, e.groesse, e.drehung);
    if (e.drehung) seite.setRotation(degrees(e.drehung));
    return aus;
  }

  const quelle = await PDFDocument.load(e.quelle, { ignoreEncryption: true });
  const quellSeiten = quelle.getPages();
  for (let i = 0; i < quellSeiten.length; i++) {
    const sp = quellSeiten[i];
    const rot = ((sp.getRotation().angle % 360) + 360) % 360;
    const eingebettet = await aus.embedPage(sp);
    const W0 = eingebettet.width;
    const H0 = eingebettet.height;
    const tausch = rot === 90 || rot === 270;
    const vw = tausch ? H0 : W0;
    const vh = tausch ? W0 : H0;
    const seite = aus.addPage([vw, vh]);
    aufrecht(seite, eingebettet, rot, W0, H0);
    zeichneBallons(
      seite,
      font,
      e.ballons.filter((b) => b.seite === i + 1),
      vw,
      vh,
      e.groesse,
      e.drehung,
    );
    if (e.drehung) seite.setRotation(degrees(e.drehung));
  }
  return aus;
}

/** Die Seiten eines fertigen PDF (z. B. die jsPDF-Prüfliste) hinten anfügen. */
export async function haengePdfAn(ziel: PDFDocument, bytes: ArrayBuffer | Uint8Array): Promise<void> {
  const quelle = await PDFDocument.load(bytes);
  const kopien = await ziel.copyPages(quelle, quelle.getPageIndices());
  kopien.forEach((s) => ziel.addPage(s));
}

/** Das PDF im Browser als Datei anbieten. */
export async function speicherePdf(doc: PDFDocument, name: string): Promise<void> {
  const bytes = await doc.save({ useObjectStreams: true });
  const puffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([puffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
