"use client";

import { useState } from "react";

import { useTexte } from "@/components/sprache/anbieter";
import { cn } from "@/lib/cn";

export type Diagrammart = "balken" | "flaeche";

/** Zustand der Umschaltung je Diagramm. Balken sind die Vorgabe wie im Altsystem. */
export function useDiagrammart(vorgabe: Diagrammart = "balken") {
  return useState<Diagrammart>(vorgabe);
}

/**
 * Balken oder Fläche für Diagramme mit Zeitachse (VER-04B).
 *
 * Nur für Verläufe: Kundenanteile, Ranglisten und Zusammensetzungen bekommen
 * sie nicht. Die Umschaltung ändert nur die Zeichnung — Daten, Zeitraum und
 * Reihen bleiben dieselben. Mehrere Reihen werden als Fläche nicht gestapelt,
 * sondern halbtransparent übereinander gelegt: Vorjahr und aktuelles Jahr sind
 * keine Summe.
 */
export function DiagrammartWahl({
  art,
  onChange,
}: {
  art: Diagrammart;
  onChange: (art: Diagrammart) => void;
}) {
  const t = useTexte();
  const stufen: Diagrammart[] = ["balken", "flaeche"];
  return (
    <div role="radiogroup" aria-label={t.diagramm.art} className="inline-flex rounded-md border border-[var(--border)] p-0.5">
      {stufen.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={art === s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
            art === s ? "bg-[var(--muted)] font-medium text-[var(--fg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {s === "balken" ? t.diagramm.balken : t.diagramm.flaeche}
        </button>
      ))}
    </div>
  );
}
