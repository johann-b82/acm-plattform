import type { Uebersichtszeile } from "@/lib/kpi/bewertung";

/**
 * Die Zahlen, die in der Kopfzeile an einem Zeichen hängen.
 *
 * Zwei Anzeigen mit derselben Frage: liegt etwas für mich da? Beide zeigen
 * eine Zahl nur, wenn sie größer als null ist — eine dauerhafte 0 lernt man
 * zu übersehen, und dann fällt die 1 auch nicht mehr auf.
 */

/** Vierstellige Zahlen sprengen den Punkt am Zeichen. */
export function badgeText(anzahl: number): string {
  return anzahl > 99 ? "99+" : String(anzahl);
}

export type MassnahmenStand = { offen: number; ueberfaellig: number };

/**
 * Zählt über alle Kennzahlen zusammen, was die Übersicht je Kennzahl schon
 * ausweist. Überfällige sind eine Teilmenge der offenen und werden deshalb
 * nicht dazugezählt, sondern färben nur.
 */
export function massnahmenStand(
  zeilen: Uebersichtszeile[] | undefined,
): MassnahmenStand {
  return (zeilen ?? []).reduce<MassnahmenStand>(
    (summe, z) => ({
      offen: summe.offen + z.offen,
      ueberfaellig: summe.ueberfaellig + z.ueberfaellig,
    }),
    { offen: 0, ueberfaellig: 0 },
  );
}
