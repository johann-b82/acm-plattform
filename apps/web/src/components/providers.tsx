"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { setSupabaseKonfig } from "@/lib/supabase/client";

/**
 * Client-Provider für die App-Shell.
 *
 * Der QueryClient wird in State erzeugt, damit er pro Browser-Sitzung
 * existiert; ein Modul-Singleton würde auf dem Server Daten zwischen Nutzern
 * mischen.
 *
 * Adresse und öffentlicher Schlüssel von Supabase kommen als Props vom Server.
 * So läuft dasselbe Image auf jedem Host, ohne neu gebaut zu werden.
 */
export function Providers({
  children,
  supabaseUrl,
  supabaseAnonKey,
}: {
  children: ReactNode;
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  // Vor dem ersten Rendern der Kinder setzen, damit deren Abfragen den Client
  // bereits vorfinden.
  setSupabaseKonfig(supabaseUrl, supabaseAnonKey);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
