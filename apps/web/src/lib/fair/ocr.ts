import type { Drehung } from "@/lib/fair";
import { drehe, mitRand } from "@/lib/fair/leinwand";

/**
 * OCR für eine Zeile der Prüfliste (FAI-05), nachgebaut nach dem Altsystem
 * (`useFairOcr.ts`, `FairEditorCanvas.tsx` → `reocrBalloon`).
 *
 * Gelesen wird das gespeicherte Feld des Ballons, frisch und scharf aus der
 * Originaldatei gerastert — nie die Leinwand am Bildschirm, deren Schärfe vom
 * Zoom abhinge. Das Feld wird mit weißem Rand in allen vier Lagen gelesen,
 * die bevorzugte zuerst; eine sichere, saubere Lesung beendet die Suche.
 *
 * Arbeiter, Kern und Sprachdaten liefert der eigene Server unter
 * `/tesseract` aus. tesseract.js lädt ohne diese Pfade von jsdelivr — das
 * verbietet die Same-Origin-Regel, und im LAN ohne Internet ginge es nicht.
 * Anders als im Altsystem startet der Arbeiter erst beim ersten Lesen: wer die
 * Zeichnung nur ansieht, lädt die 20 MB Sprachdaten nicht.
 */

export const OCR_SPRACHEN = "deu+eng";
export const OCR_PFADE = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract",
  langPath: "/tesseract/lang",
} as const;

const LAGEN: Drehung[] = [0, 90, 180, 270];
const SICHER = 80;

export function bereinigeLesung(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/**
 * Buchstaben und Ziffern zählen, Rauschzeichen (`< > | = ~ ^`), wie sie bei
 * einer falsch gedrehten Lesung entstehen, schwer bestrafen — so schlägt die
 * richtige Lage eine selbstsichere, aber sinnlose.
 */
export function bewerteLesung(
  text: string,
  konfidenz: number,
  bevorzugt: boolean,
): { punkte: number; sauber: boolean } {
  const s = text.trim();
  const buchstaben = (s.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
  const ziffern = (s.match(/\d/g) || []).length;
  const rauschen = (s.match(/[<>|~^`{}[\]\\_=]/g) || []).length;
  if (buchstaben + ziffern === 0) return { punkte: -Infinity, sauber: false };
  return {
    punkte: konfidenz + (bevorzugt ? 5 : 0) + (buchstaben + ziffern) * 2 - rauschen * 20,
    sauber: rauschen === 0,
  };
}

export async function besteLesung(
  lesen: (drehung: Drehung) => Promise<{ text: string; konfidenz: number }>,
  bevorzugt: Drehung = 0,
): Promise<string> {
  let beste = { text: "", punkte: -Infinity };
  for (const lage of [bevorzugt, ...LAGEN.filter((l) => l !== bevorzugt)]) {
    const roh = await lesen(lage);
    const text = bereinigeLesung(roh.text);
    const b = bewerteLesung(text, roh.konfidenz, lage === bevorzugt);
    if (b.punkte > beste.punkte) beste = { text, punkte: b.punkte };
    if (b.sauber && roh.konfidenz >= SICHER) break;
  }
  return beste.text;
}

/**
 * Was mit einer Lesung geschieht. Ein leeres Feld füllt die OCR direkt, wie im
 * Altsystem. Steht schon ein anderer Wert darin — oft von Hand getippt —,
 * wird erst gefragt, statt ihn still zu ersetzen.
 */
export function ocrEntscheidung(alt: string, neu: string): "leer" | "gleich" | "speichern" | "rueckfrage" {
  if (!neu.trim()) return "leer";
  if (!alt.trim()) return "speichern";
  return alt.trim() === neu.trim() ? "gleich" : "rueckfrage";
}

type Arbeiter = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;
let arbeiter: Promise<Arbeiter> | null = null;

function holeArbeiter(): Promise<Arbeiter> {
  arbeiter ??= import("tesseract.js")
    .then(async ({ createWorker, OEM, PSM }) => {
      const w = await createWorker(OCR_SPRACHEN, OEM.LSTM_ONLY, { ...OCR_PFADE });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return w;
    })
    .catch((fehler: unknown) => {
      // Beim nächsten Versuch neu starten, statt den Fehler festzuhalten.
      arbeiter = null;
      throw fehler;
    });
  return arbeiter;
}

/** Liest ein gerastertes Feld; leer, wenn nichts Brauchbares erkannt wurde. */
export async function liesFeld(leinwand: HTMLCanvasElement, bevorzugt: Drehung = 0): Promise<string> {
  const w = await holeArbeiter();
  const gerahmt = mitRand(leinwand);
  return besteLesung(async (lage) => {
    const { data } = await w.recognize(drehe(gerahmt, lage));
    return { text: data.text ?? "", konfidenz: data.confidence ?? 0 };
  }, bevorzugt);
}

/** Beim Verlassen des Editors den Arbeiter beenden. */
export function beendeOcr(): void {
  const laufend = arbeiter;
  arbeiter = null;
  void laufend?.then((w) => w.terminate()).catch(() => undefined);
}
