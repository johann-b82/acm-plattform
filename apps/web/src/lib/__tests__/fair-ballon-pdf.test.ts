import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { ballonierteZeichnung, haengePdfAn } from "@/lib/fair/ballon-pdf";
import type { Ballon } from "@/lib/fair";

function ballon(nummer: number, seite = 1): Ballon {
  return {
    id: `b${nummer}`,
    zeichnung_id: "z",
    nummer,
    seite,
    bereich_x: 0.1,
    bereich_y: 0.2,
    bereich_b: 0.1,
    bereich_h: 0.05,
    blase_x: 0.5,
    blase_y: 0.5,
    wert: `Wert ${nummer}`,
  };
}

/** Ein echtes Quell-PDF mit den gegebenen Seitengrößen. Jede Seite trägt einen
 *  minimalen Inhalt, damit sie sich einbetten lässt (leere Seiten hätten keinen
 *  Inhaltsstrom — echte Zeichnungen haben immer einen). */
async function quellPdf(seiten: [number, number][]): Promise<ArrayBuffer> {
  const src = await PDFDocument.create();
  for (const [b, h] of seiten) {
    const p = src.addPage([b, h]);
    p.drawRectangle({ x: 1, y: 1, width: 2, height: 2 });
  }
  const bytes = await src.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// 1×1 weißes PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";
function pngBytes(): ArrayBuffer {
  const bin = atob(PNG_BASE64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

describe("Ballonierte Zeichnung als Vektor-PDF", () => {
  it("bettet jede PDF-Seite in ihrer Größe ein", async () => {
    const doc = await ballonierteZeichnung({
      quelle: await quellPdf([[800, 600]]),
      art: "pdf",
      ballons: [ballon(1)],
      drehung: 0,
      groesse: 1,
    });
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(800, 3);
    expect(height).toBeCloseTo(600, 3);
  });

  it("übernimmt alle Quellseiten", async () => {
    const doc = await ballonierteZeichnung({
      quelle: await quellPdf([
        [800, 600],
        [400, 900],
      ]),
      art: "pdf",
      ballons: [ballon(1, 1), ballon(2, 2), ballon(3, 2)],
      drehung: 0,
      groesse: 1,
    });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getSize().width).toBeCloseTo(400, 3);
  });

  it("dreht die Seite mit der Ansicht, ohne die Maße zu ändern", async () => {
    const doc = await ballonierteZeichnung({
      quelle: await quellPdf([[800, 600]]),
      art: "pdf",
      ballons: [],
      drehung: 90,
      groesse: 1,
    });
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(800, 3);
  });

  it("bettet ein Bild als eine Seite in Bildgröße ein", async () => {
    const doc = await ballonierteZeichnung({
      quelle: pngBytes(),
      art: "bild",
      ballons: [ballon(1)],
      drehung: 0,
      groesse: 1,
    });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 1, height: 1 });
  });

  it("hängt die Prüflisten-Seiten hinten an", async () => {
    const doc = await ballonierteZeichnung({
      quelle: await quellPdf([[800, 600]]),
      art: "pdf",
      ballons: [ballon(1)],
      drehung: 0,
      groesse: 1,
    });
    const liste = await quellPdf([
      [595, 842],
      [595, 842],
    ]);
    await haengePdfAn(doc, liste);
    expect(doc.getPageCount()).toBe(3);
    const bytes = await doc.save();
    // Ein gültiges PDF beginnt mit %PDF.
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("%PDF");
  });
});
