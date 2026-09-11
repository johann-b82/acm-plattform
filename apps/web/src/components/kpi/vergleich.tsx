"use client";

import { useTexte } from "@/components/sprache/anbieter";
import {
  alsProzent,
  bewertung,
  delta,
  type Richtung,
} from "@/lib/kpi/vergleich";

/**
 * Ein Abzeichen an der Kachel: wie viel mehr oder weniger als vorher.
 *
 * Die Farbe folgt der **Bedeutung**, nicht dem Vorzeichen. Bei Verzugsquote
 * und Reklamationsquote ist weniger besser; dort wird ein Rückgang grün.
 *
 * Gibt es keinen Vergleichswert, erscheint gar nichts — kein Strich, kein
 * Platzhalter. Eine Kachel soll nicht nach Fehler aussehen, nur weil der
 * Vorjahreszeitraum vor dem ersten Upload liegt.
 */
export function Vergleich({
  aktuell,
  vorher,
  was,
  richtung = "mehr_ist_besser",
}: {
  aktuell: number | null | undefined;
  vorher: number | null | undefined;
  /** „zum Vormonat", „zum Vorjahr" — steht im Tooltip. */
  was: string;
  richtung?: Richtung;
}) {
  const wert = delta(aktuell, vorher);
  if (wert === null) return null;

  const stufe = bewertung(wert, richtung);
  const farbe =
    stufe === "gut" ? "status-ok" : stufe === "schlecht" ? "status-bad" : "status-none";

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs tabular-nums ${farbe}`}
      title={`${alsProzent(wert)} ${was}`}
    >
      {alsProzent(wert)}
      <span className="ml-1 opacity-70">{was}</span>
    </span>
  );
}

/**
 * Die Zeile unter dem Wert: Vorperiode und Vorjahr nebeneinander.
 *
 * Zwei Abzeichen, weil beide etwas anderes sagen. „Mehr als im Vormonat"
 * kann saisonal sein; „mehr als im Vorjahresmonat" ist es nicht.
 */
export function Vergleiche({
  aktuell,
  vorperiode,
  vorjahr,
  vorperiodeLabel,
  richtung,
}: {
  aktuell: number | null | undefined;
  vorperiode: number | null | undefined;
  vorjahr: number | null | undefined;
  vorperiodeLabel?: string;
  richtung?: Richtung;
}) {
  const t = useTexte();
  const eines =
    delta(aktuell, vorperiode) !== null || delta(aktuell, vorjahr) !== null;
  if (!eines) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Vergleich
        aktuell={aktuell}
        vorher={vorperiode}
        was={vorperiodeLabel ?? t.vergleich.vorperiode}
        richtung={richtung}
      />
      <Vergleich aktuell={aktuell} vorher={vorjahr} was={t.vergleich.vorjahr} richtung={richtung} />
    </div>
  );
}
