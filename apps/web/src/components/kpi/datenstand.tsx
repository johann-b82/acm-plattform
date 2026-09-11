"use client";

import { useQuery } from "@tanstack/react-query";

import {
  aeltester,
  alterText,
  datenstand,
  datenstandKeys,
  staende,
  type Stand,
} from "@/lib/datenstand";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" });

/**
 * Eine Zeile unter der Überschrift: wie alt sind die Daten dieser Seite.
 *
 * Genannt wird der **älteste** Stand — so alt ist die Seite. Was die einzelnen
 * Dateien sagen, steht in der Beschriftung; sie aufzuzählen wäre eine Zeile,
 * die niemand liest, solange alles frisch ist.
 */
export function Datenstand({ bereich }: { bereich: string }) {
  const { data, isLoading } = useQuery({
    queryKey: datenstandKeys.alle(),
    queryFn: datenstand,
    staleTime: 60_000,
  });
  if (isLoading) return null;

  const liste = staende(bereich, data);
  if (liste.length === 0) return null;
  const fehlende = liste.filter((s) => s.zuletzt === null);
  const aeltest = aeltester(liste);

  return (
    <p className="mt-1 text-xs text-[var(--fg-muted)]" title={aufzaehlung(liste)}>
      {fehlende.length > 0 ? (
        <>
          Datenstand unvollständig — {nenne(fehlende)}{" "}
          {fehlende.length === 1 ? "fehlt" : "fehlen"}
        </>
      ) : (
        <>
          Datenstand {DATUM.format(new Date(aeltest!))} ({alterText(aeltest!)})
        </>
      )}
    </p>
  );
}

function nenne(liste: Stand[]): string {
  return liste.map((s) => s.label).join(", ");
}

function aufzaehlung(liste: Stand[]): string {
  return liste
    .map((s) => `${s.label}: ${s.zuletzt ? DATUM.format(new Date(s.zuletzt)) : "nie"}`)
    .join("\n");
}
