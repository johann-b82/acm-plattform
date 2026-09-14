"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Die Kategorien der rechten Leiste, in fester Reihenfolge. Jede Seite ordnet
 * ihre Filter und Aktionen einer davon zu; leere Kategorien zeigt die Leiste
 * nicht.
 */
export const KATEGORIEN = ["navigation", "ansicht", "filter", "zeitraum", "aktionen"] as const;
export type Kategorie = (typeof KATEGORIEN)[number];

export type Plaetze = Partial<Record<Kategorie, HTMLElement | null>>;

/**
 * Der Platz in der rechten Leiste, in den eine Seite ihre Filter und Aktionen
 * stellt.
 *
 * `undefined` heißt: keine Schale drumherum (etwa im Komponententest) — dann
 * bleibt alles an Ort und Stelle. `null` heißt: Schale da, der Platz ist nur
 * noch nicht eingehängt; das ist der erste Durchlauf vor dem Einhängen. Die
 * Schale reicht je Kategorie einen Platz; ein einzelnes Element nimmt alle
 * Kategorien auf (so prüfen Komponententests, dass etwas in die Leiste geht).
 */
export const Werkzeugplatz = createContext<HTMLElement | Plaetze | null | undefined>(undefined);

/** Steht diese Komponente in einer Schale mit rechter Leiste? */
export function useInSchale(): boolean {
  return useContext(Werkzeugplatz) !== undefined;
}

/**
 * Stellt die Kinder in die rechte Leiste, in den Platz ihrer Kategorie. Die
 * Kinder bleiben Teil der Seite — Zustand und Kontext kommen von dort, nur
 * gezeichnet wird in der Leiste. Ohne Schale stehen sie an Ort und Stelle.
 */
export function Seitenwerkzeuge({ kategorie, children }: { kategorie: Kategorie; children: ReactNode }) {
  const platz = useContext(Werkzeugplatz);
  if (platz === undefined) return <>{children}</>;
  // Kein `instanceof HTMLElement`: auf dem Server gibt es die Klasse nicht,
  // dort liefe die Prüfung auf einen Fehler. Ein DOM-Knoten hat `nodeType`.
  const ziel = platz && "nodeType" in platz ? platz : platz?.[kategorie as Kategorie];
  if (!ziel) return null;
  return createPortal(children, ziel);
}

/**
 * Ein einzelnes Bedienelement mit Beschriftung. Die Beschriftung steht nur in
 * der Leiste — ohne Schale trägt die Seite ihre eigenen Beschriftungen, und
 * ein zweiter Titel stünde doppelt da.
 */
export function Werkzeug({ titel, children }: { titel: ReactNode; children: ReactNode }) {
  const inSchale = useInSchale();
  if (!inSchale) return <>{children}</>;
  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="text-xs text-[var(--fg-muted)]">{titel}</div>
      {children}
    </div>
  );
}
