"use client";

import { useQuery } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";

import { Zaehlknopf } from "@/components/kopfzeile/zaehlknopf";
import { bewertungApi, bewertungKeys } from "@/lib/kpi/bewertung";
import { massnahmenStand } from "@/lib/kopfzeile";

/**
 * Offene Maßnahmen aus der KPI-Bewertung, über alle Kennzahlen.
 *
 * Rot, sobald eine davon überfällig ist — eine offene Maßnahme ist normal,
 * eine überfällige ist es nicht.
 *
 * Zählt nicht selbst, sondern liest dieselbe Übersicht, die auch die Seite
 * `/kpi/bewertung` anzeigt, unter demselben Schlüssel: wer dort einen Haken
 * setzt, sieht die Zahl in der Kopfzeile sofort mitgehen, und auf dieser
 * Seite kostet die Anzeige keine zusätzliche Abfrage.
 */
export function MassnahmenKnopf() {
  const { data } = useQuery({
    queryKey: bewertungKeys.uebersicht(),
    queryFn: bewertungApi.uebersicht,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const { offen, ueberfaellig } = massnahmenStand(data);

  return (
    <Zaehlknopf
      href="/kpi/bewertung"
      beschriftung={
        offen === 0
          ? "Maßnahmen — keine offen"
          : `Maßnahmen — ${offen} offen${ueberfaellig > 0 ? `, davon ${ueberfaellig} überfällig` : ""}`
      }
      anzahl={offen}
      dringend={ueberfaellig > 0}
    >
      <ListChecks className="h-[18px] w-[18px]" aria-hidden />
    </Zaehlknopf>
  );
}
