/**
 * Gemeinsame Bausteine der Pflicht-Zuordnung — für Schulungen wie Einweisungen.
 *
 * Eine Pflicht gilt für: **alle**, eine **Abteilung**, eine **Position** oder
 * die **Kombination** Abteilung + Position. Positionen kommen aus Personio und
 * werden normiert verglichen (kleingeschrieben, ohne Mehrfachleerzeichen) — wie
 * `public.position_norm` in der Datenbank, weil Personio sie uneinheitlich
 * schreibt.
 */

export type Geltung = "alle" | "abteilung" | "position" | "abteilung_position";

export const GELTUNGEN: Geltung[] = ["alle", "abteilung", "position", "abteilung_position"];

export interface PflichtBasis {
  id: string;
  geltung: Geltung;
  abteilung: string | null;
  position: string | null;
  position_norm: string | null;
}

/** Wie `public.position_norm`: klein, getrimmt, ohne Mehrfachleerzeichen. */
export function positionNorm(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Die Achsenwerte (Abteilungen oder Positionen) einer Kreuztabelle: die aus der
 * aktiven Belegschaft plus die, die schon eine Zuordnung tragen — sonst
 * verschwände eine Zuordnung, sobald niemand mehr in der Abteilung/Position ist.
 */
export function achse(
  quelle: readonly (string | null)[],
  gepflegt: readonly (string | null)[],
): string[] {
  return [
    ...new Set([...quelle, ...gepflegt].map((a) => (a ?? "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "de"));
}
