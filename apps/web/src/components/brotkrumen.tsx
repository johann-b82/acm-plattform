"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { krumen } from "@/lib/brotkrumen";

/**
 * Der Pfad über dem Seiteninhalt. Zeigt nichts auf der Übersicht und auf
 * Adressen ohne Titel — eine Kette aus einem Glied ist keine Hilfe.
 */
export function Brotkrumen() {
  const pfad = usePathname();
  const kette = krumen(pfad ?? "/");
  if (kette.length === 0) return null;

  return (
    <nav aria-label="Pfad" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {kette.map((krume, i) => {
          // Die letzte Krume ist nur dann die aktuelle Seite, wenn die Adresse
          // auch stimmt: auf einer Detailseite endet die Kette bei der Liste,
          // und dorthin führt ein Verweis.
          const hier = krume.adresse === pfad;
          return (
            <li key={krume.adresse} className="flex items-center gap-1.5">
              {i > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 text-[var(--fg-muted)]"
                  aria-hidden
                />
              )}
              {hier ? (
                <span aria-current="page" className="font-medium">
                  {krume.titel}
                </span>
              ) : (
                <Link
                  href={krume.adresse}
                  className="rounded text-[var(--fg-muted)] underline-offset-4 transition-colors hover:text-[var(--fg)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {krume.titel}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
