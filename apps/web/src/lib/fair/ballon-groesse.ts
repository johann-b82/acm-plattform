import { useState } from "react";

import { begrenze } from "@/lib/fair/geometrie";

/**
 * Bubblegröße (FAI-04): ein Faktor für alle Ballons, unabhängig vom Zoom.
 *
 * Wie im Altsystem (`FairEditorCanvas.tsx`): Schritte von 18 %, Grenzen 0,4
 * bis 3, gemerkt im Browser für alle Zeichnungen. Der Faktor skaliert Radius
 * und Nummer gemeinsam (`ballonPixel`); eine Schriftgröße je Ballon gibt es
 * nicht — die Nummer ist immer ein fester Anteil der Blase, sonst passte sie
 * bei kleinen Blasen nicht mehr hinein. Lage, Feld und Nummer bleiben, und die
 * PDF-Ausgabe zeichnet mit demselben Faktor.
 */

export const BALLON_GROESSE_MIN = 0.4;
export const BALLON_GROESSE_MAX = 3;
const SCHRITT = 1.18;
const SPEICHER = "fair.ballonGroesse";

export function groesser(g: number): number {
  return begrenze(g * SCHRITT, BALLON_GROESSE_MIN, BALLON_GROESSE_MAX);
}

export function kleiner(g: number): number {
  return begrenze(g / SCHRITT, BALLON_GROESSE_MIN, BALLON_GROESSE_MAX);
}

export function ballonGroesseAus(text: string | null): number {
  const v = Number.parseFloat(text ?? "");
  return Number.isFinite(v) && v > 0 ? begrenze(v, BALLON_GROESSE_MIN, BALLON_GROESSE_MAX) : 1;
}

function lies(): number {
  try {
    return typeof window === "undefined" ? 1 : ballonGroesseAus(localStorage.getItem(SPEICHER));
  } catch {
    return 1;
  }
}

export function useBallonGroesse(): [number, (neu: (alt: number) => number) => void] {
  const [groesse, setGroesse] = useState(lies);
  return [
    groesse,
    (neu) => {
      const wert = neu(groesse);
      setGroesse(wert);
      try {
        localStorage.setItem(SPEICHER, String(wert));
      } catch {
        // Ohne Speicher gilt die Größe bis zum Neuladen.
      }
    },
  ];
}
