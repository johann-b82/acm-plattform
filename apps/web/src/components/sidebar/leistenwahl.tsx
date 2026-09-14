"use client";

import { ChevronDown } from "lucide-react";

/**
 * Eine Einfachauswahl in der rechten Leiste — als Auswahlliste statt als
 * Knopfreihe. In der schmalen Leiste brächen die Knöpfe um, und der gewählte
 * Eintrag spränge in die nächste Zeile; die Liste braucht immer genau eine
 * Zeile und sieht aus wie die Zeitraumwahl darunter.
 *
 * Außerhalb der Leiste zeichnen die Seiten ihre Knopfreihen weiter selbst.
 * Mehrfachauswahlen (Auditart, Standort) bleiben Chips.
 */
export function Leistenwahl<T extends string>({
  beschriftung,
  wert,
  onChange,
  optionen,
}: {
  /** Name für Screenreader; sichtbar steht er als Titel oder Kategorie darüber. */
  beschriftung: string;
  wert: T;
  onChange: (wert: T) => void;
  optionen: readonly (readonly [T, string])[];
}) {
  return (
    <div className="relative">
      <select
        aria-label={beschriftung}
        value={wert}
        onChange={(e) => onChange(e.target.value as T)}
        className={
          "h-9 w-full cursor-pointer appearance-none rounded-md border border-[var(--border)] bg-[var(--surface)] " +
          "px-2 pe-8 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        }
      >
        {optionen.map(([schluessel, name]) => (
          <option key={schluessel} value={schluessel}>
            {name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-muted)]"
        aria-hidden
      />
    </div>
  );
}
