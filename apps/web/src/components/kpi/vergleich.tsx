"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { alsProzent, bewertung, delta, type Richtung } from "@/lib/kpi/vergleich";

const FARBE = {
  gut: "text-[var(--ok)]",
  schlecht: "text-[var(--danger)]",
  neutral: "text-[var(--fg-muted)]",
} as const;

/**
 * Eine Vergleichszeile (KPI-05/06): kleiner diagonaler Pfeil, farbiger
 * Prozentwert, grauer Vergleichszeitraum — ohne Hinterlegung.
 *
 * Der Pfeil folgt der Zahl, die Farbe der Bedeutung: eine steigende
 * Personalkostenquote zeigt nach oben und ist rot. Unverändert steht als
 * waagerechter Pfeil in Grau, fehlend als Strich mit Erklärung — beides ist
 * etwas anderes als eine Veränderung.
 */
export function Vergleichszeile({
  aktuell,
  vorher,
  label,
  richtung = "mehr_ist_besser",
}: {
  aktuell: number | null | undefined;
  vorher: number | null | undefined;
  label: string;
  richtung?: Richtung;
}) {
  const t = useTexte();
  const tag = ZAHL_TAG[useSprache()];
  const wert = delta(aktuell, vorher);

  if (wert === null) {
    return (
      <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={t.vergleich.keinWert}>
        <span className="w-3.5 text-center text-[var(--fg-muted)]" aria-hidden>
          —
        </span>
        <span className="sr-only">{t.vergleich.keinWert}</span>
        <span className="text-[var(--fg-muted)]">{label}</span>
      </div>
    );
  }

  const Pfeil = wert > 0 ? ArrowUpRight : wert < 0 ? ArrowDownRight : ArrowRight;
  const farbe = FARBE[bewertung(wert, richtung)];
  const bewegung = wert > 0 ? t.vergleich.gestiegen : wert < 0 ? t.vergleich.gesunken : t.vergleich.unveraendert;

  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`inline-flex items-baseline gap-0.5 font-medium tabular-nums ${farbe}`}>
        <Pfeil className="h-3.5 w-3.5 self-center" aria-hidden />
        <span className="sr-only">{bewegung}</span>
        {alsProzent(wert, tag)}
      </span>
      <span className="text-[var(--fg-muted)]">{label}</span>
    </div>
  );
}

/**
 * Die beiden Zeilen rechts neben der Hauptzahl: oben die Vorperiode, darunter
 * das Vorjahr. Eine Zeile ohne Vergleichszeitraum (Vorperiode bei „Dieses
 * Jahr“) entfällt; ohne jeden Zeitraum („Alles“) entfällt der Block.
 */
export function Vergleiche({
  aktuell,
  vorperiode,
  vorjahr,
  vorperiodeLabel,
  vorjahrLabel,
  richtung,
}: {
  aktuell: number | null | undefined;
  vorperiode: number | null | undefined;
  vorjahr: number | null | undefined;
  vorperiodeLabel: string | null;
  vorjahrLabel: string | null;
  richtung?: Richtung;
}) {
  if (vorperiodeLabel === null && vorjahrLabel === null) return null;
  return (
    <div className="flex flex-col items-start gap-0.5 text-xs">
      {vorperiodeLabel !== null && (
        <Vergleichszeile aktuell={aktuell} vorher={vorperiode} label={vorperiodeLabel} richtung={richtung} />
      )}
      {vorjahrLabel !== null && (
        <Vergleichszeile aktuell={aktuell} vorher={vorjahr} label={vorjahrLabel} richtung={richtung} />
      )}
    </div>
  );
}
