"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabaseBrowser } from "@/lib/supabase/client";
import { schluesselFuer, tabellenThema } from "@/lib/realtime";

/**
 * Hält die Abfragen einer Seite live (ADR-0006): je Tabelle ein privater
 * Kanal; meldet die Datenbank eine Änderung, lädt die Seite die Abfragen des
 * Moduls neu — über PostgREST, also durch die Leseregel.
 *
 * Fällt der Kanal aus, bleibt die Seite bedienbar: sie lädt wie bisher beim
 * Zurückkehren ins Fenster neu, und der Konfliktschutz hängt nicht am Kanal.
 */
export function useLiveTabellen(tabellen: readonly string[]): void {
  const queryClient = useQueryClient();
  // Als Zeichenkette, damit ein neues Array beim Neuzeichnen nicht jedes Mal
  // neu abonniert.
  const liste = tabellen.join(",");

  useEffect(() => {
    const sb = supabaseBrowser();
    const kanaele: RealtimeChannel[] = [];
    let aktiv = true;

    void (async () => {
      // Private Kanäle prüft der Dienst mit dem Token der Sitzung.
      await sb.realtime.setAuth();
      if (!aktiv) return;
      for (const tabelle of liste.split(",").filter(Boolean)) {
        const kanal = sb
          .channel(tabellenThema(tabelle), { config: { private: true } })
          .on("broadcast", { event: "aenderung" }, () => {
            for (const schluessel of schluesselFuer(tabelle)) {
              void queryClient.invalidateQueries({ queryKey: [...schluessel] });
            }
          })
          .subscribe();
        kanaele.push(kanal);
      }
    })();

    return () => {
      aktiv = false;
      for (const kanal of kanaele) void sb.removeChannel(kanal);
    };
  }, [liste, queryClient]);
}
