/**
 * Realtime und Konfliktschutz (ADR-0006): die Regeln, die ohne Kanal gelten.
 *
 * Die Datenbank meldet jede Änderung einer freigegebenen Tabelle auf dem
 * privaten Kanal `tabelle:<name>` — nur Tabelle, Vorgang und Kennung. Die
 * Oberfläche lädt daraufhin die Abfragen des Moduls neu; gelesen wird also
 * weiter über PostgREST und durch die Leseregel.
 *
 * Gespeichert wird nur mit der geladenen Version. Trifft das keine Zeile, sagt
 * `leereAntwort`, warum: jemand war schneller, jemand hat gelöscht, oder die
 * Regel hat abgewiesen.
 */

/** Die Tabellen der Phase 1 und die Abfragen, die eine Änderung dort neu lädt. */
const SCHLUESSEL: Record<string, readonly (readonly string[])[]> = {
  atr_lieferungen: [["atr"]],
  atr_positionen: [["atr"]],
  audits: [["audit"]],
  audit_phasen: [["audit"]],
  maschinen: [["wartung"]],
  wartungsaufgaben: [["wartung"]],
  feedback: [["feedback"]],
};

export type Tabelle = keyof typeof SCHLUESSEL;

export function tabellenThema(tabelle: string): string {
  return `tabelle:${tabelle}`;
}

export function datensatzThema(tabelle: string, kennung: string): string {
  return `datensatz:${tabelle}:${kennung}`;
}

export function schluesselFuer(tabelle: string): (readonly string[])[] {
  return [...(SCHLUESSEL[tabelle] ?? [])];
}

export type KonfliktGrund = "konflikt" | "geloescht";

/** Ein Speichern auf veraltetem Stand — kein Rechte- oder Netzfehler. */
export class KonfliktFehler extends Error {
  readonly grund: KonfliktGrund;

  constructor(grund: KonfliktGrund) {
    super(
      grund === "konflikt"
        ? "Inzwischen von jemand anderem geändert — der aktuelle Stand ist geladen."
        : "Inzwischen von jemand anderem gelöscht.",
    );
    this.name = "KonfliktFehler";
    this.grund = grund;
  }

  static ist(fehler: unknown): fehler is KonfliktFehler {
    return fehler instanceof KonfliktFehler;
  }
}

/** Warum traf ein Speichern mit Versionsbedingung keine Zeile? `nachher` ist
 *  die Zeile, wie sie jetzt gelesen wird (oder `null`, wenn es sie nicht gibt). */
export function leereAntwort(
  nachher: { version: number } | null,
  erwartet: number,
): KonfliktGrund | "recht" {
  if (nachher === null) return "geloescht";
  if (nachher.version !== erwartet) return "konflikt";
  return "recht";
}

export interface Anwesenheit {
  kennung?: string;
  email?: string;
}

/** Wer außer einem selbst den Datensatz offen hat — jede Person einmal,
 *  nach Adresse sortiert. Mehrere Tabs derselben Person zählen einmal. */
export function anwesende(
  zustand: Record<string, readonly Anwesenheit[]>,
  eigeneKennung: string | null | undefined,
): string[] {
  const adressen = new Set<string>();
  for (const eintraege of Object.values(zustand)) {
    for (const e of eintraege) {
      if (!e.email || e.kennung === eigeneKennung) continue;
      adressen.add(e.email);
    }
  }
  return [...adressen].sort((a, b) => a.localeCompare(b));
}
