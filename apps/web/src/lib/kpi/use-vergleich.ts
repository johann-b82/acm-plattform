"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTexte } from "@/components/sprache/anbieter";
import type { Zeitraum } from "@/lib/kpi/gemeinsam";
import { vergleichsfenster } from "@/lib/kpi/vergleich";

/**
 * Dieselbe Kennzahl noch einmal — für Vorperiode und Vorjahr.
 *
 * Sechs Dashboards brauchen das Gleiche. Ohne diesen Haken stünden in jedem
 * zwei Abfragen, ein `useMemo` und die Beschriftung, und beim siebten würde
 * eine Kleinigkeit abweichen.
 *
 * Zwei Aufrufe derselben SQL-Funktion statt einer, die drei Fenster auf einmal
 * rechnet: die Rechenwege liegen in der Datenbank, und sie dort ein zweites Mal
 * — mit Vergleichslogik — auszudrücken hieße, sie an zwei Stellen zu pflegen.
 */
export function useVergleich<T>(
  schluessel: readonly unknown[],
  zeitraum: Zeitraum,
  von: string | null,
  bis: string | null,
  hole: (von: string, bis: string) => Promise<T>,
): { vorperiode: T | undefined; vorjahr: T | undefined; label: string } {
  const t = useTexte();
  const label: Record<Zeitraum, string> = {
    monat: t.vergleich.vormonat,
    quartal: t.vergleich.vorquartal,
    jahr: t.vergleich.vorperiode,
    alles: t.vergleich.vorperiode,
    frei: t.vergleich.zeitraumDavor,
  };
  const fenster = useMemo(
    () => vergleichsfenster(zeitraum, von, bis),
    [zeitraum, von, bis],
  );

  const vorperiode = useQuery({
    queryKey: [...schluessel, "vorperiode", fenster.vorperiode],
    queryFn: () => hole(fenster.vorperiode!.von, fenster.vorperiode!.bis),
    enabled: fenster.vorperiode !== null,
  });
  const vorjahr = useQuery({
    queryKey: [...schluessel, "vorjahr", fenster.vorjahr],
    queryFn: () => hole(fenster.vorjahr!.von, fenster.vorjahr!.bis),
    enabled: fenster.vorjahr !== null,
  });

  return {
    vorperiode: vorperiode.data,
    vorjahr: vorjahr.data,
    label: label[zeitraum],
  };
}
