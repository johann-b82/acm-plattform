/**
 * Manuelle Reihenfolge der Prüfliste (FAI-06).
 *
 * Die Nummer ist die Reihenfolge: `fair_reihenfolge` in der Datenbank setzt
 * die Nummern auf die Folge der Kennungen und verlangt dafür **alle** Ballons
 * der Zeichnung. Der Ballon selbst — Feld, Blase, Wert — bleibt derselbe;
 * er bekommt nur eine andere Nummer. Genau so rechnet das Altsystem
 * (`FairBalloonTable.tsx`, `reorderBalloons`).
 */

interface MitNummer {
  id: string;
  nummer: number;
}

/** Alle Kennungen in neuer Folge, nachdem `aktiv` an die Stelle von `ziel`
 *  gezogen wurde; `null`, wenn sich nichts ändert. */
export function verschobeneReihenfolge(
  ballons: readonly MitNummer[],
  aktiv: string,
  ziel: string,
): string[] | null {
  const ids = [...ballons].sort((a, b) => a.nummer - b.nummer).map((b) => b.id);
  const von = ids.indexOf(aktiv);
  const nach = ids.indexOf(ziel);
  if (von < 0 || nach < 0 || von === nach) return null;
  ids.splice(nach, 0, ...ids.splice(von, 1));
  return ids;
}

/** Die Ballons mit den Nummern, die die Datenbank gleich vergeben wird — für
 *  die Anzeige, bis die Antwort da ist. */
export function mitNeuenNummern<T extends MitNummer>(ballons: readonly T[], ids: readonly string[]): T[] {
  const nachId = new Map(ballons.map((b) => [b.id, b]));
  return ids.flatMap((id, i) => {
    const b = nachId.get(id);
    return b ? [{ ...b, nummer: i + 1 }] : [];
  });
}
