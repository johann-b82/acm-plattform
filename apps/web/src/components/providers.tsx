"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";

/**
 * Client-Provider für die App-Shell. QueryClient wird in State erzeugt, damit
 * er pro Browser-Sitzung existiert und nicht modulweit geteilt wird (auf dem
 * Server würde ein Modul-Singleton Daten zwischen Nutzern mischen).
 */
export function Providers({ children }: { children: ReactNode }) {
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
