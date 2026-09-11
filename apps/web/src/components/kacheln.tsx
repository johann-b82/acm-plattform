import Link from "next/link";

import { Seitenkopf } from "@/components/seitenkopf";
import { symbol } from "@/lib/symbole";

/**
 * Ein Raster aus Kacheln — für die Übersichtsseiten und den Starter.
 *
 * Vorher stand dasselbe Markup zweimal da und wich in Kleinigkeiten
 * voneinander ab. Das Sinnbild kommt aus `lib/symbole`: gleiche Adresse,
 * gleiches Bild, egal von welcher Seite aus jemand darauf schaut.
 */
export type Kachel = {
  pfad: string;
  name: string;
  beschreibung?: string;
  /** Kleiner Zusatz unter dem Namen, in Versalien — der Starter zeigt dort die Stufe. */
  marke?: string;
};

export function Kacheln({
  untertitel,
  eintraege,
  spalten = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  untertitel?: string;
  eintraege: Kachel[];
  spalten?: string;
}) {
  return (
    <div className="space-y-6">
      {untertitel && <Seitenkopf untertitel={untertitel} />}
      <ul className={`grid gap-4 ${spalten}`}>
        {eintraege.map((k) => {
          const Bild = symbol(k.pfad);
          return (
            <li key={k.pfad}>
              <Link
                href={k.pfad}
                className="flex h-full items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--fg-muted)]"
              >
                <Bild
                  className="h-10 w-10 shrink-0 text-[var(--fg-muted)]"
                  aria-hidden
                  strokeWidth={1.5}
                />
                <div className="min-w-0">
                  <div className="font-medium">{k.name}</div>
                  {k.beschreibung && (
                    <div className="mt-1 text-sm text-[var(--fg-muted)]">{k.beschreibung}</div>
                  )}
                  {k.marke && (
                    <div className="mt-1 text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                      {k.marke}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
