"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useSprache, useTexte } from "@/components/sprache/anbieter";
import type { Zeitraum } from "@/lib/kpi/gemeinsam";
import { beschriftungen, vergleichsfenster } from "@/lib/kpi/vergleich";
import { ZAHL_TAG } from "@/lib/sprache";

/**
 * Dieselbe Kennzahl noch einmal — für Vorperiode und Vorjahr — samt der
 * Beschriftung des konkreten Vergleichszeitraums („zum August“).
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
): { vorperiode: T | undefined; vorjahr: T | undefined; label: string | null; labelVorjahr: string | null } {
  const t = useTexte();
  const sprache = useSprache();
  const fenster = useMemo(() => vergleichsfenster(zeitraum, von, bis), [zeitraum, von, bis]);
  const labels = beschriftungen(zeitraum, von, bis, ZAHL_TAG[sprache], t.vergleich);

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
    label: labels.vorperiode,
    labelVorjahr: labels.vorjahr,
  };
}
