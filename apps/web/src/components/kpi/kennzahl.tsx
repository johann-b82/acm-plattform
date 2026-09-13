"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui/primitives";
import { ErklaerungKnopf } from "@/components/kpi/erklaerung-knopf";
import type { Erklaerung } from "@/lib/erklaerung";
import { cn } from "@/lib/cn";

/**
 * Eine Kennzahlenkachel.
 *
 * Hauptzahl links, die beiden Vergleichszeilen rechts daneben (KPI-05). Ist
 * die Kachel zu schmal, rutschen die Vergleiche darunter, statt die Zahl
 * abzuschneiden.
 *
 * Der Satz unter der Zahl bleibt einzeilig (UI-01), damit Kacheln einer Reihe
 * gleich hoch sind und ihre Zahlen auf einer Linie stehen. Was abgeschnitten
 * wird, steht vollständig in der Beschriftung und im Rechenweg hinter dem „i“.
 */
export function Kennzahl({
  titel,
  wert,
  hinweis,
  warnung,
  laedt,
  vergleich,
  erklaerung,
}: {
  titel: string;
  wert: string;
  hinweis?: string;
  /** Färbt den Wert rot — wenn er einen Zielwert reißt. */
  warnung?: boolean;
  laedt: boolean;
  /** Die Vergleichszeilen zur Vorperiode und zum Vorjahr, falls es welche gibt. */
  vergleich?: ReactNode;
  /** Welcher Hilfe-Abschnitt den Rechenweg beschreibt. Ohne ihn kein „i“. */
  erklaerung?: Erklaerung;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-1 text-sm text-[var(--fg-muted)]">
        <span className="min-w-0">{titel}</span>
        {erklaerung && <ErklaerungKnopf titel={titel} erklaerung={erklaerung} />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div
          className={cn(
            "font-mono text-2xl font-medium tabular-nums",
            warnung && "text-[var(--danger)]",
          )}
        >
          {laedt ? <span className="text-[var(--fg-muted)]">…</span> : wert}
        </div>
        {/* Erst wenn der Wert steht: ein Vergleich neben „…“ wäre sinnlos. */}
        {!laedt && vergleich}
      </div>
      {hinweis && (
        <div className="mt-1 truncate text-xs text-[var(--fg-muted)]" title={hinweis}>
          {hinweis}
        </div>
      )}
    </Card>
  );
}
