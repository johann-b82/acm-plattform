/**
 * Vergleichswerte an den Kacheln: Vorperiode und Vorjahr.
 *
 * Eine Zahl allein sagt wenig. „4,7 Mio €" ist erst dann eine Aussage, wenn
 * daneben steht, ob das mehr oder weniger ist als vorher. Das Altprojekt hat
 * dafür Abzeichen an jeder Kachel; hier fehlten sie — und die Hilfeseite
 * beschrieb sie trotzdem.
 *
 * Zwei Vergleichsfenster:
 *
 *   **Vorperiode** — gleich lang, endet am Tag vor dem gewählten Zeitraum.
 *   **Vorjahr**    — dasselbe Fenster 365 Tage früher.
 *
 * 365 Tage, nicht derselbe Kalendertag. Über ein Schaltjahr verschiebt sich das
 * um einen Tag, und das ist Absicht: ein Vergleich „gleich viele Tage" ist für
 * Mengen ehrlicher als einer, der mal 365 und mal 366 Tage umfasst.
 */

import type { Zeitraum } from "@/lib/kpi/gemeinsam";

export interface Fenster {
  von: string;
  bis: string;
}

const TAG = 86_400_000;

function alsDatum(iso: string): Date {
  // Mittags, nicht Mitternacht: so kippt keine Sommerzeitumstellung den Tag.
  return new Date(`${iso}T12:00:00`);
}

function alsIso(d: Date): string {
  const monat = String(d.getMonth() + 1).padStart(2, "0");
  const tag = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${monat}-${tag}`;
}

/** Das gleich lange Fenster davor — es endet am Tag vor `von`. */
export function vorperiode(von: string, bis: string): Fenster {
  const a = alsDatum(von).getTime();
  const b = alsDatum(bis).getTime();
  const laenge = b - a;
  const ende = a - TAG;
  return { von: alsIso(new Date(ende - laenge)), bis: alsIso(new Date(ende)) };
}

/** Dasselbe Fenster 365 Tage früher. */
export function vorjahr(von: string, bis: string): Fenster {
  return {
    von: alsIso(new Date(alsDatum(von).getTime() - 365 * TAG)),
    bis: alsIso(new Date(alsDatum(bis).getTime() - 365 * TAG)),
  };
}

/**
 * Welche Vergleiche zu einem Zeitraum passen.
 *
 * Bei „Dieses Jahr" bleibt die Vorperiode weg: sie wäre das Fenster
 * unmittelbar davor, also ein Stück des Vorjahres mit derselben Länge — eine
 * Zahl, die niemand erwartet und die neben dem Vorjahresvergleich nur
 * verwirrt. Bei „Alles" gibt es kein Fenster und damit keinen Vergleich.
 */
export function vergleichsfenster(
  zeitraum: Zeitraum,
  von: string | null,
  bis: string | null,
): { vorperiode: Fenster | null; vorjahr: Fenster | null } {
  if (!von || !bis) return { vorperiode: null, vorjahr: null };
  return {
    vorperiode: zeitraum === "jahr" ? null : vorperiode(von, bis),
    vorjahr: vorjahr(von, bis),
  };
}

/**
 * Die relative Veränderung.
 *
 * `null`, wenn es nichts zu vergleichen gibt — fehlender Vorwert oder eine
 * Null als Nenner. Eine Steigerung von null auf irgendetwas ist keine
 * Prozentangabe, und „+∞ %" hilft niemandem.
 */
export function delta(aktuell: number | null | undefined, vorher: number | null | undefined): number | null {
  if (aktuell == null || vorher == null || vorher === 0) return null;
  return (aktuell - vorher) / Math.abs(vorher);
}

/** Bei manchen Kennzahlen ist weniger besser — Verzug, Reklamationen, Krankheit. */
export type Richtung = "mehr_ist_besser" | "weniger_ist_besser";

/**
 * Wie die Veränderung zu bewerten ist.
 *
 * Die Farbe folgt der **Bedeutung**, nicht dem Vorzeichen: ein Rückgang der
 * Reklamationsquote ist gut und gehört grün, auch wenn die Zahl negativ ist.
 */
export function bewertung(
  wert: number | null,
  richtung: Richtung = "mehr_ist_besser",
): "gut" | "schlecht" | "neutral" {
  if (wert == null || wert === 0) return "neutral";
  const besser = richtung === "mehr_ist_besser" ? wert > 0 : wert < 0;
  return besser ? "gut" : "schlecht";
}

/** „+12,4 %" — mit Vorzeichen, denn ohne es wäre die Richtung nicht ablesbar. */
export function alsProzent(wert: number | null): string {
  if (wert == null) return "—";
  const zahl = new Intl.NumberFormat("de-DE", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(wert);
  return zahl;
}
