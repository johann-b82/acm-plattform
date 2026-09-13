import Link from "next/link";

import { GRUPPEN, finde } from "@/hilfe/registry";
import { cn } from "@/lib/cn";

/**
 * Die seitliche Artikelnavigation einer Hilfeseite (HIL-01).
 *
 * Alle Themen, in der Gruppierung der Übersicht — vorher stand hier nur die
 * eigene Gruppe, und wer vom Einkauf zu den Einstellungen wollte, musste zurück
 * zur Übersicht. Der aktuelle Artikel ist markiert.
 *
 * Breit steht sie als Leiste links; schmal oben als zugeklappte Liste, deren
 * Zusammenfassung sagt, wo man gerade ist. Zweimal dasselbe Markup statt eines
 * Schalters, damit es ohne Browser-Skript auskommt — die jeweils andere Hälfte
 * ist per `display: none` auch für Screenreader ausgeblendet.
 */
export function Artikelnavigation({
  aktuell,
  beschriftung,
}: {
  aktuell: string;
  beschriftung: { navigation: string; alleThemen: string };
}) {
  const liste = (
    <>
      <ul className="space-y-4">
        {GRUPPEN.map((gruppe) => (
          <li key={gruppe.id}>
            <p className="mb-1 font-medium lg:ps-3">{gruppe.titel}</p>
            <ul>
              {gruppe.seiten.map((s) => {
                const hier = s.slug === aktuell;
                return (
                  <li key={s.slug}>
                    <Link
                      href={`/hilfe/${s.slug}`}
                      aria-current={hier ? "page" : undefined}
                      className={cn(
                        "block border-s py-1 ps-3 underline-offset-4 hover:underline lg:-ms-px",
                        hier
                          ? "border-[var(--ring)] font-medium text-[var(--fg)]"
                          : "border-transparent text-[var(--fg-muted)]",
                      )}
                    >
                      {s.titel}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <Link
        href="/hilfe"
        className="mt-4 block py-1 text-[var(--fg-muted)] underline-offset-4 hover:underline lg:ps-3"
      >
        {beschriftung.alleThemen}
      </Link>
    </>
  );

  return (
    <>
      <details className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm lg:hidden">
        <summary className="cursor-pointer font-medium">
          {beschriftung.navigation}: {finde(aktuell)?.seite.titel}
        </summary>
        <div className="mt-3">{liste}</div>
      </details>
      <nav
        aria-label={beschriftung.navigation}
        className="hidden self-start text-sm lg:sticky lg:top-6 lg:block lg:border-s lg:border-[var(--border)]"
      >
        {liste}
      </nav>
    </>
  );
}
