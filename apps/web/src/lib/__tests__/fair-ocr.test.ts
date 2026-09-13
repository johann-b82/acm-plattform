import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  besteLesung,
  bewerteLesung,
  bereinigeLesung,
  OCR_PFADE,
  OCR_SPRACHEN,
  ocrEntscheidung,
} from "@/lib/fair/ocr";
import { DATEIEN } from "../../../scripts/tesseract-dateien.mjs";

const WEB = path.resolve(__dirname, "../../..");

describe("OCR je Zeile (FAI-05)", () => {
  it("fasst Zeilen und Leerraum zusammen", () => {
    expect(bereinigeLesung("  Ø 12,0\n\n h7 \t ")).toBe("Ø 12,0 h7");
  });

  it("bestraft Rauschzeichen, die typisch für eine falsche Lage sind", () => {
    const sauber = bewerteLesung("12,5", 70, false);
    const rauschen = bewerteLesung("|<~=", 95, true);
    expect(sauber.punkte).toBeGreaterThan(rauschen.punkte);
    expect(sauber.sauber).toBe(true);
    expect(bewerteLesung("   ", 99, true).punkte).toBe(-Infinity);
  });

  it("probiert die Lagen, beginnt mit der bevorzugten und hört bei einer sicheren sauberen Lesung auf", async () => {
    const gelesen: number[] = [];
    const text = await besteLesung(async (drehung) => {
      gelesen.push(drehung);
      return drehung === 90 ? { text: "25 ±0,1", konfidenz: 91 } : { text: "|~", konfidenz: 40 };
    }, 0);
    expect(text).toBe("25 ±0,1");
    expect(gelesen).toEqual([0, 90]);
  });

  it("liefert leer, wenn keine Lage etwas Brauchbares hergibt", async () => {
    expect(await besteLesung(async () => ({ text: "", konfidenz: 0 }))).toBe("");
  });

  it("überschreibt einen vorhandenen, anderen Wert nicht ungefragt", () => {
    expect(ocrEntscheidung("", "12,0")).toBe("speichern");
    expect(ocrEntscheidung("  ", "12,0")).toBe("speichern");
    expect(ocrEntscheidung("12,0", "12,0")).toBe("gleich");
    expect(ocrEntscheidung("12,0 h7", "12,0")).toBe("rueckfrage");
    expect(ocrEntscheidung("12,0", "")).toBe("leer");
  });

  it("lädt Arbeiter, Kern und Sprachdaten nur vom eigenen Server", () => {
    for (const pfad of Object.values(OCR_PFADE)) expect(pfad).toMatch(/^\/tesseract/);
    for (const sprache of OCR_SPRACHEN.split("+")) {
      expect(existsSync(path.join(WEB, "public/tesseract/lang", `${sprache}.traineddata.gz`))).toBe(true);
    }
  });

  it("kopiert beim Bauen den Arbeiter und jede Kernvariante, die der Arbeiter wählen kann", () => {
    const ziele = (DATEIEN as { von: string; nach: string }[]).map((d) => d.nach);
    expect(ziele).toContain("worker.min.js");
    // LSTM-only (OEM 1): je nach Browser relaxed-SIMD, SIMD oder ohne.
    const kern = readFileSync(path.join(WEB, "node_modules/tesseract.js/src/worker-script/browser/getCore.js"), "utf8");
    for (const variante of kern.match(/tesseract-core[a-z-]*-lstm\.wasm\.js/g) ?? []) {
      expect(ziele).toContain(variante);
    }
    for (const d of DATEIEN as { von: string }[]) {
      expect(existsSync(path.join(WEB, "node_modules", d.von))).toBe(true);
    }
  });
});
