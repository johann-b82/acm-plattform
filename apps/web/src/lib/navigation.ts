import { hasLevel, levelFor, type Apps, type Level } from "@/lib/rechte";

/**
 * Was die Seitenleiste zeigt: die Apps, für die ein Recht besteht, und darunter
 * die Unterseiten ihrer Übersicht.
 *
 * Reine Daten, damit Server (Layout) und Test dasselbe rechnen. Die Titel der
 * Unterseiten kommen aus dem Wörterbuch (`pfad.seiten`), die Namen der Apps
 * aus der Tabelle `apps` — wie auf den Kacheln des Starters.
 */

export type AppZeile = { id: string; name: string; path: string; sort: number };

export type Unterseite = {
  pfad: string;
  /** Unter welcher Adresse der Titel im Wörterbuch steht. Unter KPI heißen die
   *  HR-Kennzahlen „HR“, wie ihre Kachel dort. */
  titelVon: string;
};

export type NavEintrag = { pfad: string; name: string; unterseiten: Unterseite[] };

/** Der gemerkte Zustand „eingeklappt“ der Seitenleiste. */
export const SEITENLEISTE_COOKIE = "seitenleiste";

/** Der gemerkte Zustand „eingeklappt“ der rechten Leiste mit Filtern und Aktionen. */
export const WERKZEUGLEISTE_COOKIE = "werkzeugleiste";

/** `platform` und `settings` sind Querschnitt, keine Apps: die Einstellungen
 *  hängen im Benutzermenü. Dieselbe Regel wie auf dem Starter. */
const QUERSCHNITT = ["platform", "settings"];

type Vorgabe = { pfad: string; titelVon?: string; app: string; stufe?: Level };

/** Die Unterseiten je Übersicht, in der Reihenfolge ihrer Kacheln — mit dem
 *  Recht, das die Seite selbst verlangt (`requireApp`). */
const UNTERSEITEN: Record<string, Vorgabe[]> = {
  "/kpi": [
    { pfad: "/kpi/vertrieb", app: "kpi" },
    { pfad: "/hr/kennzahlen", titelVon: "/hr", app: "hr" },
    { pfad: "/kpi/qualitaet", app: "kpi" },
    { pfad: "/kpi/finanzen", app: "kpi" },
    { pfad: "/kpi/einkauf", app: "kpi" },
    { pfad: "/kpi/produktion", app: "kpi" },
    { pfad: "/kpi/bewertung", app: "kpi" },
  ],
  "/hr": [
    { pfad: "/hr/kennzahlen", app: "hr" },
    { pfad: "/hr/organigramm", app: "hr" },
    { pfad: "/hr/kompetenzen", app: "hr" },
    { pfad: "/hr/schulungen", app: "hr" },
    { pfad: "/hr/onboarding", app: "hr" },
    { pfad: "/hr/zeugnisse", app: "hr", stufe: "editor" },
  ],
  "/atr": [
    { pfad: "/atr/lieferungen", app: "atr" },
    { pfad: "/atr/teilekatalog", app: "atr" },
  ],
  "/newsletter": [{ pfad: "/newsletter/redaktion", app: "newsletter", stufe: "editor" }],
};

export function navigation(apps: readonly AppZeile[], rechte: Apps): NavEintrag[] {
  return [...apps]
    .sort((a, b) => a.sort - b.sort)
    .filter((a) => !QUERSCHNITT.includes(a.id) && levelFor(rechte, a.id))
    .map((a) => ({
      pfad: a.path,
      name: a.name,
      unterseiten: (UNTERSEITEN[a.path] ?? [])
        .filter((u) => hasLevel(rechte, u.app, u.stufe))
        .map((u) => ({ pfad: u.pfad, titelVon: u.titelVon ?? u.pfad })),
    }));
}
