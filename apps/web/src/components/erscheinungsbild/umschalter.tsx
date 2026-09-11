"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { useTexte } from "@/components/sprache/anbieter";
import {
  abonnieren,
  anwenden,
  aufDemServer,
  gespeichert,
  merken,
  type Erscheinungsbild,
} from "@/lib/erscheinungsbild";

const STUFEN: { wert: Erscheinungsbild; Zeichen: typeof Sun }[] = [
  { wert: "hell", Zeichen: Sun },
  { wert: "dunkel", Zeichen: Moon },
  { wert: "system", Zeichen: Monitor },
];

/**
 * Hell, dunkel oder wie das System — drei Felder nebeneinander.
 *
 * Kein Umschalter, der zwischen zwei Zuständen springt: „wie das System" ist
 * die Vorgabe und muss erreichbar bleiben. Ein Zweifachschalter nähme einem
 * den Weg dorthin zurück.
 *
 * Die Wahl kommt über `useSyncExternalStore` und nicht aus einem Effekt: der
 * Server kennt den `localStorage` nicht, und ein Effekt, der Zustand nachzieht,
 * wäre genau das Muster, das React ablehnt. Nebenbei gleichen sich damit
 * mehrere offene Tabs von selbst ab.
 */
export function ErscheinungsbildUmschalter() {
  const t = useTexte();
  const wahl = useSyncExternalStore(abonnieren, gespeichert, aufDemServer);
  const label: Record<Erscheinungsbild, string> = {
    hell: t.kopf.hell,
    dunkel: t.kopf.dunkel,
    system: t.kopf.system,
  };

  function waehle(neu: Erscheinungsbild) {
    anwenden(neu);
    merken(neu);
  }

  return (
    <div
      role="group"
      aria-label={t.kopf.erscheinungsbild}
      className="inline-flex items-center rounded-md border border-[var(--border)] p-0.5"
    >
      {STUFEN.map(({ wert, Zeichen }) => {
        const an = wahl === wert;
        return (
          <button
            key={wert}
            type="button"
            aria-label={label[wert]}
            title={label[wert]}
            aria-pressed={an}
            onClick={() => waehle(wert)}
            className={
              "inline-flex h-7 w-8 items-center justify-center rounded transition-colors " +
              "focus-visible:outline-2 focus-visible:outline-offset-1 " +
              "focus-visible:outline-[var(--ring)] " +
              (an
                ? "bg-[var(--muted)] text-[var(--fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]")
            }
          >
            <Zeichen className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
