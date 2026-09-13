"use client";

import { cn } from "@/lib/cn";

/**
 * Eine fachliche Auswahl aus wenigen festen Möglichkeiten — im Stil der
 * Seitengröße in den Einstellungen. Ein Klick wirkt sofort.
 */
export function Segmentwahl<W extends string>({
  wert,
  optionen,
  onChange,
  beschriftung,
}: {
  wert: W;
  optionen: readonly { wert: W; titel: string; anzahl?: number }[];
  onChange: (wert: W) => void;
  beschriftung: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={beschriftung}
      className="inline-flex flex-wrap rounded-md border border-[var(--border)] p-0.5"
    >
      {optionen.map((o) => (
        <button
          key={o.wert}
          type="button"
          role="radio"
          aria-checked={wert === o.wert}
          onClick={() => wert !== o.wert && onChange(o.wert)}
          className={cn(
            "rounded px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
            wert === o.wert ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {o.titel}
          {o.anzahl !== undefined && <span className="ms-1.5 tabular-nums opacity-70">{o.anzahl}</span>}
        </button>
      ))}
    </div>
  );
}
