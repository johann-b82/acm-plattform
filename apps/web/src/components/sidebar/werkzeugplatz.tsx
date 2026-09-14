"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Der Platz in der rechten Leiste, in den eine Seite ihre Filter und Aktionen
 * stellt.
 *
 * `undefined` heißt: keine Schale drumherum (etwa im Komponententest) — dann
 * bleibt alles an Ort und Stelle. `null` heißt: Schale da, der Platz ist nur
 * noch nicht eingehängt; das ist der erste Durchlauf vor dem Einhängen.
 */
export const Werkzeugplatz = createContext<HTMLElement | null | undefined>(undefined);

/** Steht diese Komponente in einer Schale mit rechter Leiste? */
export function useInSchale(): boolean {
  return useContext(Werkzeugplatz) !== undefined;
}

/**
 * Stellt die Kinder in die rechte Leiste. Die Kinder bleiben Teil der Seite —
 * Zustand und Kontext kommen von dort, nur gezeichnet wird in der Leiste.
 * Ohne Schale stehen sie an Ort und Stelle.
 */
export function Seitenwerkzeuge({ children }: { children: ReactNode }) {
  const platz = useContext(Werkzeugplatz);
  if (platz === undefined) return <>{children}</>;
  if (!platz) return null;
  return createPortal(children, platz);
}
