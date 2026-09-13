"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTexte } from "@/components/sprache/anbieter";
import { Card } from "@/components/ui/primitives";
import { plattformApi, plattformKeys } from "@/lib/plattform-einstellungen";
import { SEITENGROESSEN, type Seitengroesse } from "@/lib/tabelle";
import { cn } from "@/lib/cn";

/**
 * Wie viele Zeilen eine Tabelle je Seite zeigt — für alle Tabellen und alle
 * Personen (TAB-01). Drei feste Größen, sofort gespeichert: eine Auswahl aus
 * drei Werten braucht keinen eigenen Speichern-Knopf.
 */
export function Tabellen() {
  const t = useTexte();
  const queryClient = useQueryClient();
  const stand = useQuery({ queryKey: plattformKeys.alle(), queryFn: plattformApi.lesen });

  const setzen = useMutation({
    mutationFn: (groesse: Seitengroesse) => plattformApi.seitengroesseSetzen(groesse),
    onSuccess: () => {
      toast.success(t.tabelle.gespeichert);
      return queryClient.invalidateQueries({ queryKey: plattformKeys.alle() });
    },
    onError: (fehler: Error) => toast.error(t.einstellungenText.speichernFehler(fehler.message)),
  });

  const aktuell = stand.data?.tabellen_seitengroesse ?? 25;

  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-medium" id="tabellen-seitengroesse">
        {t.tabelle.seitengroesse}
      </h3>
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">{t.tabelle.seitengroesseText}</p>
      <div
        role="radiogroup"
        aria-labelledby="tabellen-seitengroesse"
        className="inline-flex rounded-md border border-[var(--border)] p-0.5"
      >
        {SEITENGROESSEN.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={aktuell === g}
            disabled={stand.isLoading || setzen.isPending}
            onClick={() => aktuell !== g && setzen.mutate(g)}
            className={cn(
              "rounded px-4 py-1 text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
              aktuell === g ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {g}
          </button>
        ))}
      </div>
    </Card>
  );
}
