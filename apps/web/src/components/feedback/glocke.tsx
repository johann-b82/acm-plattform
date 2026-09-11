"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { Zaehlknopf } from "@/components/kopfzeile/zaehlknopf";
import { useTexte } from "@/components/sprache/anbieter";
import { feedbackApi, feedbackKeys } from "@/lib/feedback";

/**
 * Die Glocke: wie viele Seitenmeldungen noch niemand angesehen hat.
 *
 * Nur für die Plattform-Verwaltung — die Kopfzeile blendet sie sonst gar
 * nicht erst ein, und die Leseregel auf `feedback` zählt für alle anderen
 * ohnehin 0.
 *
 * Fragt alle 60 Sekunden nach und beim Zurückkommen ins Fenster. Eine Meldung
 * ist nichts, was auf die Sekunde ankommt; ein offener Kanal (Realtime) für
 * eine Zahl wäre Aufwand ohne Gewinn.
 */
export function FeedbackGlocke() {
  const t = useTexte();
  const { data: anzahl = 0 } = useQuery({
    queryKey: feedbackKeys.offen(),
    queryFn: feedbackApi.ungeseheneAnzahl,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  return (
    <Zaehlknopf
      href="/platform/feedback"
      beschriftung={anzahl === 0 ? t.kopf.meldungenLeer : t.kopf.meldungen(anzahl)}
      anzahl={anzahl}
    >
      <Bell className="h-[18px] w-[18px]" aria-hidden />
    </Zaehlknopf>
  );
}
