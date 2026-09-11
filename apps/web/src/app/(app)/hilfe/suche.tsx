"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { suche } from "@/hilfe/registry";
import { Card, Input } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Volltextsuche über die Hilfe.
 *
 * Sie läuft im Browser über die Seiten, die ohnehin im Bündel stecken — die
 * Hilfe ist rund 1.200 Zeilen, dafür braucht es keinen Index und keine Abfrage.
 */
export function Suche() {
  const t = useTexte();
  const [begriff, setBegriff] = useState("");
  const treffer = useMemo(() => suche(begriff), [begriff]);
  const gesucht = begriff.trim().length >= 2;

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-muted)]"
          aria-hidden
        />
        <Input
          value={begriff}
          placeholder={t.hilfe.suchen}
          aria-label={t.hilfe.suchen}
          className="ps-9"
          onChange={(e) => setBegriff(e.target.value)}
        />
      </div>

      {gesucht && (
        <Card className="p-4">
          {treffer.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">
              {t.hilfe.nichtsGefunden}
            </p>
          ) : (
            <ul className="space-y-2">
              {treffer.map(({ seite, gruppe }) => (
                <li key={seite.slug}>
                  <Link
                    href={`/hilfe/${seite.slug}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {seite.titel}
                  </Link>
                  <span className="ms-2 text-xs text-[var(--fg-muted)]">{gruppe.titel}</span>
                  <p className="text-sm text-[var(--fg-muted)]">{seite.kurz}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
