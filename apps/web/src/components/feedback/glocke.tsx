"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { Zaehlknopf } from "@/components/kopfzeile/zaehlknopf";
import { useTexte } from "@/components/sprache/anbieter";
import { useLiveTabellen } from "@/components/realtime/live";
import { feedbackApi, feedbackKeys } from "@/lib/feedback";

/** Die Glocke hängt am Kanal von App Feedback (ADR-0006). */
const LIVE_TABELLEN = ["feedback"];

/**
 * Die Glocke: wie viele Seitenmeldungen noch niemand angesehen hat.
 *
 * Nur für die Plattform-Verwaltung — die Kopfzeile blendet sie sonst gar
 * nicht erst ein, und die Leseregel auf `feedback` zählt für alle anderen
 * ohnehin 0.
 *
 * Live über den Realtime-Kanal von App Feedback: kommt eine Meldung dazu oder
 * hakt jemand sie ab, stimmt die Zahl sofort (ADR-0006). Beim Zurückkommen ins
 * Fenster fragt sie trotzdem nach — falls der Kanal gerade nicht steht.
 */
export function FeedbackGlocke() {
  const t = useTexte();
  useLiveTabellen(LIVE_TABELLEN);
  const { data: anzahl = 0 } = useQuery({
    queryKey: feedbackKeys.offen(),
    queryFn: feedbackApi.ungeseheneAnzahl,
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
