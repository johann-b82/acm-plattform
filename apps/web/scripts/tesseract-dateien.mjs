/**
 * Legt Arbeiter und Kern von tesseract.js unter `public/tesseract` ab, damit
 * die FAIR-OCR nur vom eigenen Server lädt. Ohne ausdrückliche Pfade holt
 * tesseract.js beides von jsdelivr — das verletzt die Same-Origin-Regel und
 * scheitert im LAN ohne Internet.
 *
 * Läuft vor `next dev` und `next build` (auch im Docker-Build). Die Dateien
 * stammen aus `node_modules` und werden deshalb nicht eingecheckt; die
 * Sprachdaten unter `public/tesseract/lang` dagegen schon — sie gibt es in
 * keinem installierten Paket, und ein Abruf beim Bauen bräuchte Internet.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

// Nur LSTM-Kerne: der Arbeiter startet mit OEM 1 und wählt dann je nach
// Browser die Variante mit relaxed SIMD, mit SIMD oder ohne. `.wasm.js`
// enthält das WebAssembly bereits.
export const DATEIEN = [
  { von: "tesseract.js/dist/worker.min.js", nach: "worker.min.js" },
  ...[
    "tesseract-core-relaxedsimd-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-lstm.wasm.js",
  ].map((datei) => ({ von: `tesseract.js-core/${datei}`, nach: datei })),
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ziel = join(WEB, "public", "tesseract");
  mkdirSync(ziel, { recursive: true });
  for (const d of DATEIEN) copyFileSync(join(WEB, "node_modules", d.von), join(ziel, d.nach));
}
