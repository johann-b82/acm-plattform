"use client";

import { cn } from "@/lib/cn";

/** Ein Element in einem Set umschalten — als neue Menge, für `setState`. */
export function umschalten<T>(menge: ReadonlySet<T>, wert: T): Set<T> {
  const neu = new Set(menge);
  if (neu.has(wert)) neu.delete(wert);
  else neu.add(wert);
  return neu;
}

/**
 * Standortauswahl als Chips (SCH-02). Mehrfachauswahl; leere Auswahl heißt
 * „alle Standorte“. Die verfügbaren Standorte kommen aus den Daten, nicht aus
 * einer festen Liste — steht ein Standort in keiner Zeile, gibt es ihn hier
 * nicht.
 */
export function Standortfilter({
  standorte,
  gewaehlt,
  onToggle,
  beschriftung,
}: {
  standorte: readonly string[];
  gewaehlt: ReadonlySet<string>;
  onToggle: (standort: string) => void;
  beschriftung: string;
}) {
  if (standorte.length === 0) return null;
  return (
    <div role="group" aria-label={beschriftung} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--fg-muted)]">{beschriftung}</span>
      {standorte.map((s) => {
        const an = gewaehlt.has(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={an}
            onClick={() => onToggle(s)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
              an
                ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]"
                : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
