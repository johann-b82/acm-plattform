"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTexte } from "@/components/sprache/anbieter";
import { Card } from "@/components/ui/primitives";
import { plattformApi, plattformKeys, type Datenquelle as DQ } from "@/lib/plattform-einstellungen";
import { cn } from "@/lib/cn";

const WERTE: DQ[] = ["extrakte", "odbc"];

/**
 * Woher die Kennzahlen kommen: die monatlichen Extrakt-Uploads oder der
 * ODBC-Worker, der Apollo live liest. Zwei feste Werte, sofort gespeichert.
 * Steht die Quelle auf „ODBC", sperrt die compute-Seite die manuellen Importe
 * (409) — die Upload-Seite zeigt das zusätzlich an.
 */
export function Datenquelle() {
  const t = useTexte();
  const dq = t.einstellungenText.datenquelle;
  const queryClient = useQueryClient();
  const stand = useQuery({ queryKey: plattformKeys.alle(), queryFn: plattformApi.lesen });

  const setzen = useMutation({
    mutationFn: (quelle: DQ) => plattformApi.datenquelleSetzen(quelle),
    onSuccess: () => {
      toast.success(dq.gespeichert);
      return queryClient.invalidateQueries({ queryKey: plattformKeys.alle() });
    },
    onError: (fehler: Error) => toast.error(t.einstellungenText.speichernFehler(fehler.message)),
  });

  const aktuell = stand.data?.datenquelle ?? "extrakte";

  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-medium" id="datenquelle">
        {dq.titel}
      </h3>
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">{dq.text}</p>
      <div
        role="radiogroup"
        aria-labelledby="datenquelle"
        className="inline-flex rounded-md border border-[var(--border)] p-0.5"
      >
        {WERTE.map((q) => (
          <button
            key={q}
            type="button"
            role="radio"
            aria-checked={aktuell === q}
            disabled={stand.isLoading || setzen.isPending}
            onClick={() => aktuell !== q && setzen.mutate(q)}
            className={cn(
              "rounded px-4 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
              aktuell === q ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {dq[q]}
          </button>
        ))}
      </div>
      {aktuell === "odbc" && (
        <p role="status" className="max-w-prose text-sm text-[var(--fg-muted)]">
          {dq.hinweisOdbc}
        </p>
      )}
    </Card>
  );
}
