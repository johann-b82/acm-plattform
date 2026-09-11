"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Eine Kennzahlenkachel.
 *
 * Stand vorher in jedem Dashboard einmal, bis auf eine Kleinigkeit identisch.
 * Als sechsmal dasselbe Feld für die Vergleichswerte zu ergänzen gewesen wäre,
 * war klar, dass es eine Kachel sein muss und nicht sechs — sonst wiche beim
 * siebten Dashboard eine Kleinigkeit ab.
 */
export function Kennzahl({
  titel,
  wert,
  hinweis,
  warnung,
  laedt,
  vergleich,
}: {
  titel: string;
  wert: string;
  hinweis?: string;
  /** Färbt den Wert rot — wenn er einen Zielwert reißt. */
  warnung?: boolean;
  laedt: boolean;
  /** Die Abzeichen zur Vorperiode und zum Vorjahr, falls es welche gibt. */
  vergleich?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="text-sm text-[var(--fg-muted)]">{titel}</div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl font-medium tabular-nums",
          warnung && "text-[var(--danger)]",
        )}
      >
        {laedt ? <span className="text-[var(--fg-muted)]">…</span> : wert}
      </div>
      {hinweis && <div className="mt-1 text-xs text-[var(--fg-muted)]">{hinweis}</div>}
      {/* Erst wenn der Wert steht: ein Abzeichen neben „…" wäre sinnlos. */}
      {!laedt && vergleich}
    </Card>
  );
}
