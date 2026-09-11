"use client";

import { useQuery } from "@tanstack/react-query";

import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import {
  aeltester,
  alterInTagen,
  datenstand,
  datenstandKeys,
  staende,
  type Stand,
} from "@/lib/datenstand";

/**
 * Eine Zeile unter der Überschrift: wie alt sind die Daten dieser Seite.
 *
 * Genannt wird der **älteste** Stand — so alt ist die Seite. Was die einzelnen
 * Dateien sagen, steht in der Beschriftung; sie aufzuzählen wäre eine Zeile,
 * die niemand liest, solange alles frisch ist.
 */
export function Datenstand({ bereich }: { bereich: string }) {
  const t = useTexte();
  const sprache = useSprache();
  const DATUM = new Intl.DateTimeFormat(SPRACHE_TAG[sprache], { dateStyle: "short" });
  const { data, isLoading } = useQuery({
    queryKey: datenstandKeys.alle(),
    queryFn: datenstand,
    staleTime: 60_000,
  });
  if (isLoading) return null;

  const liste = staende(bereich, data, t.datenstand.arten);
  if (liste.length === 0) return null;
  const fehlende = liste.filter((s) => s.zuletzt === null);
  const aeltest = aeltester(liste);

  return (
    <p className="mt-1 text-xs text-[var(--fg-muted)]" title={aufzaehlung(liste)}>
      {fehlende.length > 0
        ? t.datenstand.unvollstaendig(nenne(fehlende), fehlende.length)
        : t.datenstand.stand(DATUM.format(new Date(aeltest!)), alter(alterInTagen(aeltest!)))}
    </p>
  );

  function alter(tage: number): string {
    if (tage === 0) return t.datenstand.heute;
    if (tage === 1) return t.datenstand.gestern;
    return t.datenstand.vorTagen(tage);
  }

  function nenne(liste: Stand[]): string {
    return liste.map((s) => s.label).join(", ");
  }

  function aufzaehlung(liste: Stand[]): string {
    return liste
      .map((s) => `${s.label}: ${s.zuletzt ? DATUM.format(new Date(s.zuletzt)) : t.datenstand.nie}`)
      .join("\n");
  }
}
