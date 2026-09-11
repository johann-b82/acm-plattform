"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Ein eigener Provider statt `components/providers`.
 *
 * Der der App richtet zusätzlich den Supabase-Client ein und hängt die
 * Meldungsleiste an — beides braucht eine Sitzung, und beides hat auf einer
 * Tafel nichts zu suchen.
 *
 * Eine Tafel läuft wochenlang durch, ohne dass jemand das Fenster anfasst.
 * Deshalb wird stur alle fünf Minuten nachgeladen: sonst stünde am Montag noch
 * die Woche von vorletztem Freitag.
 */
export function AnzeigeProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60_000,
            refetchInterval: 5 * 60_000,
            refetchIntervalInBackground: true,
            retry: 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
