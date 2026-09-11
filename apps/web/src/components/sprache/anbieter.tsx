"use client";

import { createContext, useContext } from "react";

import type { Sprache } from "@/lib/sprache";
import { texteFuer, type Texte } from "@/texte";

const Zusammenhang = createContext<{ sprache: Sprache; texte: Texte } | null>(null);

/**
 * Reicht die Sprache der Anfrage an die Browser-Bestandteile weiter.
 *
 * Der Server hat sie schon aus dem Cookie gelesen; hier wird sie nur gereicht,
 * nicht noch einmal ermittelt. Zwei Stellen, die dasselbe herausfinden, sind
 * zwei Stellen, die verschiedener Meinung sein können.
 */
export function SprachAnbieter({
  sprache,
  children,
}: {
  sprache: Sprache;
  children: React.ReactNode;
}) {
  return (
    <Zusammenhang.Provider value={{ sprache, texte: texteFuer(sprache) }}>
      {children}
    </Zusammenhang.Provider>
  );
}

/** Die Texte im Browser. Wirft, wenn der Anbieter fehlt — lieber laut. */
export function useTexte(): Texte {
  const wert = useContext(Zusammenhang);
  if (!wert) throw new Error("useTexte ohne SprachAnbieter");
  return wert.texte;
}

export function useSprache(): Sprache {
  const wert = useContext(Zusammenhang);
  if (!wert) throw new Error("useSprache ohne SprachAnbieter");
  return wert.sprache;
}
