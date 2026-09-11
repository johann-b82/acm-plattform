import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { GRUPPEN } from "@/hilfe/registry";
import { Card } from "@/components/ui/primitives";
import { Suche } from "./suche";

export const metadata = { title: "Hilfe · ACM-Plattform" };

/**
 * Die Übersicht der Hilfe.
 *
 * Kein Rechte-Tor über `requireApp`: die Hilfe beschreibt die Plattform, und
 * jeder Angemeldete darf nachlesen, was es gibt — auch das, wofür ihm gerade
 * das Recht fehlt. Sonst wüsste niemand, worum er bitten müsste.
 */
export default async function HilfePage() {
  await requireSession();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hilfe</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
          Was die Plattform kann, wie die Zahlen zustande kommen und was zu tun
          ist, wenn etwas nicht stimmt.
        </p>
      </div>

      <Suche />

      <div className="space-y-8">
        {GRUPPEN.map((gruppe) => (
          <section key={gruppe.id} className="space-y-3">
            <div>
              <h2 className="text-lg font-medium tracking-tight">{gruppe.titel}</h2>
              <p className="text-sm text-[var(--fg-muted)]">{gruppe.beschreibung}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gruppe.seiten.map((seite) => (
                <li key={seite.slug}>
                  <Link href={`/hilfe/${seite.slug}`} className="block h-full">
                    <Card className="h-full p-4 transition-colors hover:bg-[var(--muted)]">
                      <p className="font-medium">{seite.titel}</p>
                      <p className="mt-1 text-sm text-[var(--fg-muted)]">{seite.kurz}</p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
