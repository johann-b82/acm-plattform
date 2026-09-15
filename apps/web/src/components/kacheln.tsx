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
}: {
  untertitel?: string;
  eintraege: Kachel[];
}) {
  return (
    <div className="space-y-6">
      {untertitel && <Seitenkopf untertitel={untertitel} />}
      {/* Alle Kacheln gleich breit und nur so breit wie nötig: so viele
          Spalten von höchstens 18rem, wie in die Zeile passen; auf schmalen
          Bildschirmen nie breiter als der Platz. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),18rem))] gap-4">
        {eintraege.map((k) => {
          const Bild = symbol(k.pfad);
          return (
            <li key={k.pfad}>
              <Link
                href={k.pfad}
                className="relative block h-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--fg-muted)]"
              >
                <div className="min-w-0">
                  {/* Rechts Platz für das Sinnbild in der Ecke, damit ein langer
                      Name nicht darunter läuft. */}
                  <div className="pe-8 font-medium">{k.name}</div>
                  {/* Zwei Textzeilen sind immer reserviert — ob Beschreibung
                      oder Rechtestufe, ob ein- oder zweizeilig —, damit alle
                      Kacheln (App-Starter wie Übersichten) gleich hoch wirken
                      und das Sinnbild überall dieselbe Höhe bekommt. */}
                  <div className="mt-1 min-h-[2.5rem]">
                    {k.beschreibung !== undefined && (
                      <div className="line-clamp-2 text-sm text-[var(--fg-muted)]">
                        {k.beschreibung}
                      </div>
                    )}
                    {k.marke && (
                      <div className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                        {k.marke}
                      </div>
                    )}
                  </div>
                </div>
                {/* Das Sinnbild sitzt klein oben rechts in der Ecke, in fester
                    Größe — ein umbrechender Name verschiebt es nicht. */}
                <span className="absolute top-4 end-4">
                  <Bild className="h-[1.40625rem] w-[1.40625rem] text-[var(--fg-muted)]" aria-hidden strokeWidth={1.5} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
