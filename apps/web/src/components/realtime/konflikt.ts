"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTexte } from "@/components/sprache/anbieter";
import { KonfliktFehler } from "@/lib/realtime";

/**
 * Die Fehlermeldung eines Speicherns (ADR-0006). War jemand anders schneller
 * oder hat gelöscht, sagt sie das in der Sprache der Oberfläche und lädt den
 * aktuellen Stand — alles andere überlässt sie der Seite (`sonst`) oder zeigt
 * den Text des Fehlers wie bisher.
 */
export function useKonfliktMeldung() {
  const t = useTexte();
  const queryClient = useQueryClient();

  return (fehler: Error, sonst?: (fehler: Error) => void): void => {
    if (KonfliktFehler.ist(fehler)) {
      toast.error(fehler.grund === "konflikt" ? t.kopf.konflikt : t.kopf.geloeschtVonAnderen);
      void queryClient.invalidateQueries();
      return;
    }
    if (sonst) sonst(fehler);
    else toast.error(fehler.message);
  };
}
