"use client";

import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useTexte } from "@/components/sprache/anbieter";
import { supabaseBrowser } from "@/lib/supabase/client";
import { anwesende, datensatzThema, type Anwesenheit as Eintrag } from "@/lib/realtime";

/**
 * „Auch geöffnet von …“ (ADR-0006): wer denselben Datensatz gerade offen hat.
 *
 * Presence auf dem privaten Kanal `datensatz:<tabelle>:<kennung>` — beitreten
 * darf, wer die Tabelle lesen darf. Nichts davon liegt in der Datenbank; wer
 * die Seite schließt, verschwindet. Mehrere Tabs derselben Person zählen einmal.
 */
export function Anwesenheit({ tabelle, kennung }: { tabelle: string; kennung: string }) {
  const t = useTexte();
  const [namen, setNamen] = useState<string[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    let kanal: RealtimeChannel | null = null;
    let aktiv = true;

    void (async () => {
      const [{ data }] = await Promise.all([sb.auth.getUser(), sb.realtime.setAuth()]);
      if (!aktiv) return;
      const ich = data.user;
      const k = sb.channel(datensatzThema(tabelle, kennung), {
        config: { private: true, presence: { key: ich?.id ?? "" } },
      });
      kanal = k;
      k.on("presence", { event: "sync" }, () =>
        setNamen(anwesende(k.presenceState() as Record<string, Eintrag[]>, ich?.id)),
      ).subscribe((status: string) => {
        if (status === "SUBSCRIBED") void k.track({ kennung: ich?.id, email: ich?.email });
      });
    })();

    return () => {
      aktiv = false;
      if (kanal) void sb.removeChannel(kanal);
    };
  }, [tabelle, kennung]);

  if (namen.length === 0) return null;
  return (
    <p role="status" className="text-xs text-[var(--fg-muted)]">
      {t.kopf.auchGeoeffnet(namen.join(", "))}
    </p>
  );
}
