"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";

function abonniere(melde: () => void) {
  window.addEventListener("hashchange", melde);
  return () => window.removeEventListener("hashchange", melde);
}

/**
 * Ein Abschnitt zum Auf- und Zuklappen, wie im Altsystem.
 *
 * Überschrift und Anzahl stehen immer da; nur der Inhalt verschwindet. Er wird
 * dabei versteckt, nicht abgebaut — ein halb getippter Wert in einer Zelle
 * überlebt das Zuklappen. Springt eine Adresse mit `#id` hierher (etwa die
 * alte `/hr/einarbeitung`), steht der Abschnitt offen.
 */
export function Klappbar({
  id,
  titel,
  anzahl,
  offenStart = true,
  ebene = "h2",
  zusatz,
  children,
}: {
  id?: string;
  titel: ReactNode;
  anzahl?: number;
  offenStart?: boolean;
  ebene?: "h2" | "h3";
  /** Bedienelemente rechts neben der Überschrift. */
  zusatz?: ReactNode;
  children: ReactNode;
}) {
  const inhalt = useId();
  const [gewaehlt, setGewaehlt] = useState<boolean | null>(null);
  const hash = useSyncExternalStore(abonniere, () => window.location.hash, () => "");
  const offen = gewaehlt ?? (offenStart || (!!id && hash === `#${id}`));
  const Ueberschrift = ebene;

  return (
    <section id={id} className="scroll-mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Ueberschrift className="min-w-0 flex-1 text-base font-medium">
          <button
            type="button"
            aria-expanded={offen}
            aria-controls={inhalt}
            onClick={() => setGewaehlt(!offen)}
            className="flex w-full items-center gap-2 rounded text-start focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[var(--fg-muted)] transition-transform",
                !offen && "-rotate-90 rtl:rotate-90",
              )}
              aria-hidden
            />
            <span className="truncate">{titel}</span>
            {anzahl !== undefined && (
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-normal tabular-nums text-[var(--fg-muted)]">
                {anzahl}
              </span>
            )}
          </button>
        </Ueberschrift>
        {zusatz}
      </div>
      <div id={inhalt} hidden={!offen} className="border-t border-[var(--border)]">
        {children}
      </div>
    </section>
  );
}
