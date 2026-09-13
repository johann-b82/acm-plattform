/**
 * Vergleichswerte an den Kacheln: Vorperiode und Vorjahr (KPI-05/06, VER-02).
 *
 * Die Fenster folgen dem Kalender, wie die Vertriebskacheln des Altsystems
 * (`frontend/src/lib/prevBounds.ts`):
 *
 *   **Monat**   — Vormonat vom 1. bis zum selben Tag; „zum August“.
 *   **Quartal** — Vorquartal vom ersten Tag bis zum selben Abstand.
 *   **Jahr**    — nur das Vorjahr bis zum selben Kalendertag.
 *   **Frei**    — der gleich lange Zeitraum unmittelbar davor.
 *   **Vorjahr** — dieselben Kalendertage ein Jahr früher.
 *
 * Vorher rechnete die Plattform überall „gleich lang, endet am Tag davor“.
 * Das trägt die Beschriftung „zum Vormonat“ nicht: am 12. September war das der
 * 20. bis 31. August. Das Altsystem rechnete in Einkauf, Produktion und Finanzen
 * ebenso — mit derselben irreführenden Beschriftung. Beides ist hier auf den
 * Kalender vereinheitlicht; die Entscheidung steht in
 * `docs/abgleich/entscheidungen.md`.
 *
 * Zwei Abweichungen vom Altsystem sind Absicht: am Monatsende bleibt das
 * Vormonatsfenster im Vormonat (dort lief `addDays` in den laufenden Monat
 * hinein), und aus dem 29. Februar wird im Vorjahr der 28.
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

function tageZwischen(von: Date, bis: Date): number {
  return Math.round((bis.getTime() - von.getTime()) / TAG);
}

function plusTage(d: Date, tage: number): Date {
  const neu = new Date(d);
  neu.setDate(neu.getDate() + tage);
  return neu;
}

/** Erster Tag des Monats, der `monate` Monate vor dem Monat von `d` liegt. */
function monatsanfang(d: Date, monate: number): Date {
  return new Date(d.getFullYear(), d.getMonth() - monate, 1, 12);
}

/** Dasselbe Datum ein Jahr früher; der 29. Februar wird zum 28. */
function einJahrFrueher(d: Date): Date {
  const ziel = new Date(d.getFullYear() - 1, d.getMonth(), 1, 12);
  const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0, 12).getDate();
  ziel.setDate(Math.min(d.getDate(), letzter));
  return ziel;
}

/** Vorperiode im Kalender: Anfang `monate` davor, gleicher Abstand, nie über ihr Ende. */
function kalendervorperiode(von: Date, bis: Date, monate: number): Fenster {
  const anfang = monatsanfang(von, monate);
  const ende = plusTage(monatsanfang(von, 0), -1);
  const kandidat = plusTage(anfang, tageZwischen(von, bis));
  return { von: alsIso(anfang), bis: alsIso(kandidat > ende ? ende : kandidat) };
}

/** Das gleich lange Fenster davor — es endet am Tag vor `von`. */
export function vorperiode(von: string, bis: string): Fenster {
  const tage = tageZwischen(alsDatum(von), alsDatum(bis)) + 1;
  return { von: alsIso(plusTage(alsDatum(von), -tage)), bis: alsIso(plusTage(alsDatum(bis), -tage)) };
}

/** Dieselben Kalendertage ein Jahr früher. */
export function vorjahr(von: string, bis: string): Fenster {
  return { von: alsIso(einJahrFrueher(alsDatum(von))), bis: alsIso(einJahrFrueher(alsDatum(bis))) };
}

export function vergleichsfenster(
  zeitraum: Zeitraum,
  von: string | null,
  bis: string | null,
): { vorperiode: Fenster | null; vorjahr: Fenster | null } {
  if (!von || !bis || zeitraum === "alles") return { vorperiode: null, vorjahr: null };
  const a = alsDatum(von);
  const b = alsDatum(bis);
  const vp =
    zeitraum === "monat"
      ? kalendervorperiode(a, b, 1)
      : zeitraum === "quartal"
        ? kalendervorperiode(a, b, 3)
        : zeitraum === "jahr"
          ? null
          : vorperiode(von, bis);
  return { vorperiode: vp, vorjahr: vorjahr(von, bis) };
}

/** Die sprachabhängigen Bausteine der Beschriftung. */
export interface Vergleichsworte {
  zu: (was: string) => string;
  quartal: (q: number) => string;
  jahr: (j: number) => string;
}

/**
 * Was neben dem Prozentwert steht: der konkrete Vergleichszeitraum.
 *
 * Das Jahr steht nur dabei, wo es sonst mehrdeutig wäre — beim Vormonat im
 * selben Jahr heißt es „zum August“, im Januar „zum Dezember 2025“.
 */
export function beschriftungen(
  zeitraum: Zeitraum,
  von: string | null,
  bis: string | null,
  sprachTag: string,
  worte: Vergleichsworte,
): { vorperiode: string | null; vorjahr: string | null } {
  const f = vergleichsfenster(zeitraum, von, bis);
  if (!von || !f.vorjahr) return { vorperiode: null, vorjahr: null };
  const anfang = alsDatum(von);
  const jahr = anfang.getFullYear();
  const monatsname = (d: Date) => new Intl.DateTimeFormat(sprachTag, { month: "long" }).format(d);
  const quartal = (d: Date) => Math.floor(d.getMonth() / 3) + 1;
  const datum = new Intl.DateTimeFormat(sprachTag, { day: "2-digit", month: "2-digit", year: "numeric" });
  const spanne = (x: Fenster) => `${datum.format(alsDatum(x.von))}–${datum.format(alsDatum(x.bis))}`;

  if (zeitraum === "monat") {
    const vor = alsDatum(f.vorperiode!.von);
    return {
      vorperiode: worte.zu(vor.getFullYear() === jahr ? monatsname(vor) : `${monatsname(vor)} ${vor.getFullYear()}`),
      vorjahr: worte.zu(`${monatsname(anfang)} ${jahr - 1}`),
    };
  }
  if (zeitraum === "quartal") {
    const vor = alsDatum(f.vorperiode!.von);
    const q = worte.quartal(quartal(vor));
    return {
      vorperiode: worte.zu(vor.getFullYear() === jahr ? q : `${q} ${vor.getFullYear()}`),
      vorjahr: worte.zu(`${worte.quartal(quartal(anfang))} ${jahr - 1}`),
    };
  }
  if (zeitraum === "jahr") return { vorperiode: null, vorjahr: worte.zu(worte.jahr(jahr - 1)) };
  return { vorperiode: worte.zu(spanne(f.vorperiode!)), vorjahr: worte.zu(spanne(f.vorjahr)) };
}

/**
 * Die relative Veränderung.
 *
 * `null`, wenn es nichts zu vergleichen gibt — fehlender Vorwert oder eine
 * Null als Nenner. `0` heißt unverändert und ist etwas anderes als fehlend.
 */
export function delta(aktuell: number | null | undefined, vorher: number | null | undefined): number | null {
  if (aktuell == null || vorher == null || vorher === 0) return null;
  return (aktuell - vorher) / Math.abs(vorher);
}

/**
 * Welche Richtung fachlich günstig ist. `neutral` für Kennzahlen, bei denen
 * weder mehr noch weniger für sich gut ist — dort bleibt der Wert grau, statt
 * einen Erfolg zu behaupten.
 */
export type Richtung = "mehr_ist_besser" | "weniger_ist_besser" | "neutral";

/** Die Farbe folgt der Bedeutung, der Pfeil der Zahl. */
export function bewertung(
  wert: number | null,
  richtung: Richtung = "mehr_ist_besser",
): "gut" | "schlecht" | "neutral" {
  if (wert == null || wert === 0 || richtung === "neutral") return "neutral";
  const besser = richtung === "mehr_ist_besser" ? wert > 0 : wert < 0;
  return besser ? "gut" : "schlecht";
}

/** „12,4 %“ — ohne Vorzeichen; die Richtung zeigt der Pfeil davor. */
export function alsProzent(wert: number | null, sprachTag: string): string {
  if (wert == null) return "—";
  return new Intl.NumberFormat(sprachTag, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(wert));
}
