"use client";

import { usePathname } from "next/navigation";

import { useTexte } from "@/components/sprache/anbieter";
import { LANGER_NAME, krumen } from "@/lib/brotkrumen";

/**
 * Der Name der Seite, mittig in der Kopfzeile.
 *
 * Er kommt aus derselben Tafel wie der Pfad — eine Seite heißt einmal, und
 * der Verweis dorthin heißt genauso. Fünf Seiten tragen ausgeschrieben einen
 * längeren Namen als ihre Krume; die stehen in `LANGER_NAME`.
 *
 * Auf einer Detailseite endet die Kette bei ihrer Liste. Hier steht dann der
 * Abschnitt („Schulungen"), und die Seite selbst nennt den Datensatz darunter
 * beim Namen. Das ist die Arbeitsteilung: oben wo, unten welche.
 */
export function Seitentitel() {
  const t = useTexte();
  const pfad = usePathname() ?? "/";
  const lang = LANGER_NAME[pfad];
  const kette = krumen(pfad, t.pfad.seiten, t.pfad.start);
  const titel = lang
    ? (t.kopftitel as Record<string, string>)[lang]
    : kette.length > 0
      ? kette[kette.length - 1].titel
      : null;
  if (!titel) return null;

  return (
    <h1
      className={
        "pointer-events-none absolute left-1/2 hidden -translate-x-1/2 " +
        "truncate px-4 text-base font-semibold tracking-tight md:block"
      }
    >
      {titel}
    </h1>
  );
}
