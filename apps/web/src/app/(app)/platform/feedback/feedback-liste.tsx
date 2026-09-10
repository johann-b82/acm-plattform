"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Image as BildIcon } from "lucide-react";

import {
  feedbackApi,
  feedbackKeys,
  type Feedback,
  type FeedbackStatus,
} from "@/lib/feedback";
import { Button, Card, EmptyState, Select } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";

const DATUM = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Was aus den Ansichten gemeldet wurde.
 *
 * Das Bild liegt im Eimer `feedback` und ist nicht öffentlich. Es wird erst
 * geholt, wenn jemand es ansieht — über eine signierte URL, die nach fünf
 * Minuten verfällt.
 */
export function FeedbackListe() {
  const queryClient = useQueryClient();
  const [bild, setBild] = useState<{ url: string; seite: string } | null>(null);

  const liste = useQuery({ queryKey: feedbackKeys.liste(), queryFn: feedbackApi.liste });
  const meldungen = liste.data ?? [];
  const ungesehen = meldungen.filter((m) => m.gesehen_am === null).length;
  const offen = meldungen.filter((m) => m.status === "neu").length;

  const neuLaden = () =>
    queryClient.invalidateQueries({ queryKey: feedbackKeys.liste() });

  const setzeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackStatus }) =>
      feedbackApi.status(id, status),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (m: Feedback) => feedbackApi.loeschen(m.id, m.bild_pfad),
    onSuccess: () => {
      toast.success("Meldung gelöscht.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const zeigeBild = useMutation({
    mutationFn: async (m: Feedback) => ({
      url: await feedbackApi.bildUrl(m.bild_pfad!),
      seite: m.seite,
    }),
    onSuccess: setBild,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const merkeGesehen = useMutation({
    mutationFn: (id: string) => feedbackApi.gesehen(id),
    onSuccess: neuLaden,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meldungen</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Was aus den Ansichten gemeldet wurde. {offen} offen
          {ungesehen > 0 && ` · ${ungesehen} noch nicht angesehen`}
        </p>
      </div>

      {liste.isLoading && <p className="text-sm text-[var(--fg-muted)]">Wird geladen …</p>}

      {!liste.isLoading && meldungen.length === 0 && (
        <EmptyState
          title="Nichts gemeldet"
          body="Über den Knopf unten rechts kann jede angemeldete Person melden, was auf einer Seite nicht stimmt."
        />
      )}

      <ul className="space-y-3">
        {meldungen.map((m) => (
          <li key={m.id}>
            <Card
              className={`p-4 ${m.gesehen_am === null ? "border-l-2 border-l-[var(--fg)]" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-sm">{m.beschreibung}</p>
                  <p className="mt-2 text-xs text-[var(--fg-muted)]">
                    {m.melder_email ?? "unbekannt"} · {m.seite} ·{" "}
                    {DATUM.format(new Date(m.erstellt_am))}
                    {m.ansicht && ` · ${m.ansicht}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.bild_pfad && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        zeigeBild.mutate(m);
                        if (m.gesehen_am === null) merkeGesehen.mutate(m.id);
                      }}
                    >
                      <BildIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Bild
                    </Button>
                  )}
                  <Select
                    value={m.status}
                    aria-label="Status"
                    className="h-8 w-32 text-xs"
                    onChange={(e) =>
                      setzeStatus.mutate({
                        id: m.id,
                        status: e.target.value as FeedbackStatus,
                      })
                    }
                  >
                    <option value="neu">offen</option>
                    <option value="erledigt">erledigt</option>
                  </Select>
                  <ConfirmDeleteButton
                    itemLabel="Meldung"
                    onConfirm={() => loeschen.mutateAsync(m).then(() => undefined)}
                  />
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog
        open={bild !== null}
        onOpenChange={(o) => !o && setBild(null)}
        title="Aufnahme der Seite"
        description={bild?.seite}
        className="w-[min(72rem,calc(100vw-2rem))]"
      >
        {bild && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bild.url}
            alt={`Aufnahme von ${bild.seite}`}
            className="max-h-[70vh] w-full rounded-md border border-[var(--border)] object-contain"
          />
        )}
      </Dialog>
    </div>
  );
}
