"use client";

import { useMemo, useState } from "react";

import { ZEITRAUM_LABEL, fenster, type Zeitraum } from "@/lib/kpi/gemeinsam";
import { cn } from "@/lib/cn";

/** Die üblichen Stufen. Das Personal-Dashboard lässt „Alles" weg — ohne
 *  Fenster wäre der Nenner seiner Quoten unbestimmt. */
export const STUFEN: Zeitraum[] = ["monat", "quartal", "jahr", "alles", "frei"];
export const STUFEN_MIT_FENSTER: Zeitraum[] = ["monat", "quartal", "jahr", "frei"];

function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Zeitraumwahl {
  zeitraum: Zeitraum;
  setZeitraum: (z: Zeitraum) => void;
  frei: { von: string; bis: string };
  setFrei: (f: { von: string; bis: string }) => void;
  von: string | null;
  bis: string | null;
  /** Wahr, wenn bei freier Wahl das Ende vor dem Anfang liegt. */
  verdreht: boolean;
}

/**
 * Zeitraumwahl mit Zustand.
 *
 * Stand vorher in jedem Dashboard einmal — vier Knöpfe und ein `useState`.
 * Der freie Zeitraum kam nicht dazu, weil er sechsmal hätte gebaut werden
 * müssen.
 *
 * Das freie Fenster hat einen eigenen Zustand, der beim Umschalten auf einen
 * Vorschlag **nicht** verlorengeht: wer versehentlich auf „Dieses Jahr" tippt,
 * findet seine Daten danach noch vor.
 */
export function useZeitraumwahl(vorgabe: Zeitraum = "jahr"): Zeitraumwahl {
  const [zeitraum, setZeitraum] = useState<Zeitraum>(vorgabe);
  const [frei, setFrei] = useState(() => {
    const bis = heuteIso();
    return { von: `${bis.slice(0, 4)}-01-01`, bis };
  });

  const verdreht = zeitraum === "frei" && frei.von > frei.bis;

  const { von, bis } = useMemo(() => {
    if (zeitraum !== "frei") return fenster(zeitraum);
    // Ein verdrehtes Fenster wird nicht abgefragt — sonst käme eine leere
    // Antwort zurück und sähe aus wie „keine Daten".
    if (frei.von > frei.bis) return { von: null, bis: null };
    return { von: frei.von, bis: frei.bis };
  }, [zeitraum, frei]);

  return { zeitraum, setZeitraum, frei, setFrei, von, bis, verdreht };
}

/** Die Knöpfe — und bei freier Wahl zwei Datumsfelder darunter. */
export function Zeitraumwahl({
  wahl,
  stufen = STUFEN,
}: {
  wahl: Zeitraumwahl;
  stufen?: Zeitraum[];
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="inline-flex rounded-md border border-[var(--border)] p-0.5">
        {stufen.map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => wahl.setZeitraum(z)}
            aria-pressed={wahl.zeitraum === z}
            className={cn(
              "rounded px-3 py-1 text-sm transition-colors",
              wahl.zeitraum === z
                ? "bg-[var(--fg)] text-[var(--bg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {ZEITRAUM_LABEL[z]}
          </button>
        ))}
      </div>

      {wahl.zeitraum === "frei" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-[var(--fg-muted)]">von</span>
            <input
              type="date"
              value={wahl.frei.von}
              max={wahl.frei.bis}
              aria-label="Zeitraum von"
              onChange={(e) => wahl.setFrei({ ...wahl.frei, von: e.target.value })}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[var(--fg-muted)]">bis</span>
            <input
              type="date"
              value={wahl.frei.bis}
              min={wahl.frei.von}
              aria-label="Zeitraum bis"
              onChange={(e) => wahl.setFrei({ ...wahl.frei, bis: e.target.value })}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
            />
          </label>
          {wahl.verdreht && (
            <span className="text-[var(--danger)]">Das Ende liegt vor dem Anfang.</span>
          )}
        </div>
      )}
    </div>
  );
}
