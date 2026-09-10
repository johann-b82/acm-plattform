"use client";

import { pdfjs } from "react-pdf";

/**
 * Der pdf.js-Arbeiter, einmal für die ganze Anwendung gesetzt.
 *
 * Zwei Dinge müssen hier zusammenpassen, sonst bleibt die Zeichnung leer.
 *
 * Erstens läuft die Einstellung über `react-pdf`s eigenen `pdfjs`-Export, nicht
 * über einen blanken `pdfjs-dist`-Import — sonst setzt man sie auf einer
 * zweiten Instanz des Moduls, und die, die react-pdf benutzt, hat weiterhin
 * keinen Arbeiter.
 *
 * Zweitens muss `pdfjs-dist` oben im Projekt **genau** die Fassung sein, die
 * react-pdf verlangt (10.5.0 hängt an 5.4.296). Steht dort eine andere, legt
 * npm die verlangte daneben, und der Arbeiter kommt aus einer anderen
 * Hauptversion als die Bibliothek. Die Folge ist nur „ließ sich nicht laden",
 * ohne Hinweis worauf. Deshalb die feste Fassung und der `overrides`-Eintrag
 * in `package.json`. Dieselbe Falle steckt im Altprojekt in
 * `player/lib/pdfWorker.ts`.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
