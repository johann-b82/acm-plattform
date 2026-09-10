"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";

/**
 * Eine Erklärung, die erst auf Nachfrage Platz braucht.
 *
 * Auf der Einstellungsseite stand unter jeder Überschrift und jedem Feld ein
 * Absatz Fließtext. Beim ersten Mal hilfreich, danach nur noch Weg zwischen
 * den Feldern — deshalb hängt der Text jetzt am Fragezeichen daneben.
 *
 * Er erscheint bei Mauszeiger **und** bei Tastaturfokus, und ein Klick hält
 * ihn offen (auf dem Tablet gibt es kein Überfahren). Für Vorlesesoftware
 * bleibt er immer da: geschlossen als `sr-only`, verbunden über
 * `aria-describedby` — sonst wäre die Erklärung für sie schlicht weg.
 */
export function Hinweis({ text }: { text: string }) {
  const id = useId();
  const [offen, setOffen] = useState(false);

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="Erklärung"
        aria-expanded={offen}
        aria-describedby={id}
        className={
          "inline-flex h-5 w-5 items-center justify-center rounded-full " +
          "text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] " +
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
        }
        onMouseEnter={() => setOffen(true)}
        onMouseLeave={() => setOffen(false)}
        onFocus={() => setOffen(true)}
        onBlur={() => setOffen(false)}
        onClick={() => setOffen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOffen(false);
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className={
          offen
            ? "absolute left-0 top-full z-20 mt-1 w-[min(20rem,calc(100vw-3rem))] " +
              "rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 " +
              "text-left text-xs font-normal leading-relaxed text-[var(--fg-muted)] shadow-md"
            : "sr-only"
        }
      >
        {text}
      </span>
    </span>
  );
}
