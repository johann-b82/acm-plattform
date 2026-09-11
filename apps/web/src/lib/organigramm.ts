import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Das Organigramm — wer wem berichtet.
 *
 * Die Kette steht in Personio und kommt über die Sicht `organigramm` herein:
 * eine flache Liste mit Person und Vorgesetztem. Der Baum entsteht hier, nicht
 * in SQL. Eine rekursive Abfrage könnte das auch, aber sie müsste dieselben
 * Fälle abfangen — Kreise, sich selbst als Vorgesetzten, verwaiste Verweise —
 * und das ist in einer Sprache mit `Map` kürzer und besser zu prüfen.
 */

export interface Person {
  id: number;
  name: string | null;
  position: string | null;
  department: string | null;
  standort: string | null;
  vorgesetzter_id: number | null;
}

export interface Knoten extends Person {
  kinder: Knoten[];
}

export const organigrammKeys = {
  alle: () => ["organigramm"] as const,
};

export async function ladeOrganigramm(): Promise<Person[]> {
  const { data, error } = await supabaseBrowser()
    .from("organigramm")
    .select("id,name,position,department,standort,vorgesetzter_id")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Person[];
}

export function anzeigename(p: Person): string {
  return p.name?.trim() || `#${p.id}`;
}

/**
 * Aus der flachen Liste einen Wald bauen.
 *
 * Wurzel ist, wer keinen Vorgesetzten hat **oder** dessen Vorgesetzter nicht
 * in der Liste steht — etwa weil er ausgetreten ist und die Sicht nur Aktive
 * führt. Ohne diesen Fall verschwände ein ganzer Ast.
 *
 * Zwei Dinge werden abgefangen, weil gepflegte Daten sie hergeben:
 *
 *   * **sich selbst als Vorgesetzter** — ein Klassiker bei der
 *     Geschäftsführung,
 *   * **Kreise** — A berichtet an B, B an A. Wer dabei zur Wurzel wird, ist
 *     willkürlich; wichtig ist nur, dass niemand verschwindet und das
 *     Zeichnen nicht endlos läuft.
 */
export function baueWald(personen: Person[]): Knoten[] {
  const nachId = new Map<number, Knoten>();
  for (const p of personen) nachId.set(p.id, { ...p, kinder: [] });

  const wurzeln: Knoten[] = [];
  for (const knoten of nachId.values()) {
    const chef =
      knoten.vorgesetzter_id != null ? nachId.get(knoten.vorgesetzter_id) : undefined;
    if (chef && chef.id !== knoten.id && !istNachfahre(nachId, chef, knoten.id)) {
      chef.kinder.push(knoten);
    } else {
      wurzeln.push(knoten);
    }
  }

  const sortiere = (liste: Knoten[]) => {
    liste.sort((a, b) => anzeigename(a).localeCompare(anzeigename(b), "de"));
    for (const k of liste) sortiere(k.kinder);
  };
  sortiere(wurzeln);
  return wurzeln;
}

/** Hängt `moeglicherChef` bereits unter `id`? Dann wäre die Kante ein Kreis. */
function istNachfahre(
  nachId: Map<number, Knoten>,
  moeglicherChef: Knoten,
  id: number,
): boolean {
  let lauf: Knoten | undefined = moeglicherChef;
  const gesehen = new Set<number>();
  while (lauf) {
    if (lauf.id === id) return true;
    if (gesehen.has(lauf.id)) return false; // schon geschlossener Kreis
    gesehen.add(lauf.id);
    lauf = lauf.vorgesetzter_id != null ? nachId.get(lauf.vorgesetzter_id) : undefined;
  }
  return false;
}

/** Alle Standorte, die vorkommen — für den Filter. */
export function standorte(personen: Person[]): string[] {
  return [...new Set(personen.map((p) => p.standort).filter((s): s is string => !!s))].sort();
}

/**
 * Den Wald auf die Treffer zusammenstreichen — samt ihrer Vorgesetztenkette.
 *
 * Ein Suchergebnis ohne seine Kette wäre wertlos: „Meier" allein sagt nicht,
 * wo Meier im Haus sitzt.
 */
export function filtere(
  personen: Person[],
  begriff: string,
  standort: string | null,
): Person[] {
  const gesucht = begriff.trim().toLowerCase();
  if (!gesucht && !standort) return personen;

  const nachId = new Map(personen.map((p) => [p.id, p]));
  const behalten = new Set<number>();

  for (const p of personen) {
    const passtText =
      !gesucht ||
      `${p.name ?? ""} ${p.position ?? ""} ${p.department ?? ""}`
        .toLowerCase()
        .includes(gesucht);
    const passtOrt = !standort || p.standort === standort;
    if (!passtText || !passtOrt) continue;

    // Den Treffer und alle darüber behalten.
    let lauf: Person | undefined = p;
    const gesehen = new Set<number>();
    while (lauf && !gesehen.has(lauf.id)) {
      gesehen.add(lauf.id);
      behalten.add(lauf.id);
      lauf = lauf.vorgesetzter_id != null ? nachId.get(lauf.vorgesetzter_id) : undefined;
    }
  }
  return personen.filter((p) => behalten.has(p.id));
}
