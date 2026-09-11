"use client";

import { useEffect, useState } from "react";
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
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";


/**
 * Was aus den Ansichten gemeldet wurde.
 *
 * Das Bild liegt im Eimer `feedback` und ist nicht öffentlich. Es wird erst
 * geholt, wenn jemand es ansieht — über eine signierte URL, die nach fünf
 * Minuten verfällt.
 */
export function FeedbackListe() {
  const t = useTexte();
  const DATUM = new Intl.DateTimeFormat(SPRACHE_TAG[useSprache()], {
    dateStyle: "short",
    timeStyle: "short",
  });
  const queryClient = useQueryClient();
  const [bild, setBild] = useState<{ url: string; seite: string } | null>(null);

  const liste = useQuery({ queryKey: feedbackKeys.liste(), queryFn: feedbackApi.liste });
  const meldungen = liste.data ?? [];
  const offen = meldungen.filter((m) => m.status === "neu").length;
  const ungesehen = meldungen.filter((m) => m.gesehen_am === null).length;

  // Auch die Zahl an der Glocke in der Kopfzeile: sie zählt in der Datenbank
  // und merkt von einer hier angesehenen Meldung sonst erst beim nächsten Takt.
  const neuLaden = async () => {
    await queryClient.invalidateQueries({ queryKey: feedbackKeys.liste() });
    await queryClient.invalidateQueries({ queryKey: feedbackKeys.offen() });
  };

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

  // Was hier zu sehen ist, gilt als angesehen. Das ist der Takt, in dem die
  // Glocke in der Kopfzeile wieder auf null geht: Seite geöffnet, gelesen,
  // erledigt. Im Kreis läuft der Effekt nicht — die Liste wird danach nicht
  // neu geladen, der Schlüssel bleibt also stehen.
  const schluessel = meldungen
    .filter((m) => m.gesehen_am === null)
    .map((m) => m.id)
    .join(",");
  const { mutate: merkeGesehen } = useMutation({
    mutationFn: (ids: string[]) => feedbackApi.gesehen(ids),
    // Nur die Zahl in der Kopfzeile, nicht die Liste: der Strich am Rand
    // markiert, was beim Öffnen neu war, und soll stehen bleiben, solange man
    // hier ist. Ein Neuladen würde ihn eine Zehntelsekunde nach dem Öffnen
    // wegnehmen — und die Menge unter dem Effekt gleich mit.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feedbackKeys.offen() }),
  });
  useEffect(() => {
    if (schluessel) merkeGesehen(schluessel.split(","));
  }, [schluessel, merkeGesehen]);

  return (
    <div className="space-y-6">
      <Seitenkopf
        titel={t.pfad.seiten["/platform/feedback"]}
        untertitel={
          <>
            {t.meldungen.stand(offen)}
            {ungesehen > 0 && t.meldungen.neuSeit(ungesehen)}
          </>
        }
      />

      {liste.isLoading && <p className="text-sm text-[var(--fg-muted)]">{t.allgemein.laedt}</p>}

      {!liste.isLoading && meldungen.length === 0 && (
        <EmptyState
          title={t.meldungen.nichtsGemeldet}
          body={t.meldungen.nichtsGemeldetText}
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
                    {m.melder_email ?? t.meldungen.unbekannt} · {m.seite} ·{" "}
                    {DATUM.format(new Date(m.erstellt_am))}
                    {m.ansicht && ` · ${m.ansicht}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.bild_pfad && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => zeigeBild.mutate(m)}
                    >
                      <BildIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t.meldungen.bild}
                    </Button>
                  )}
                  <Select
                    value={m.status}
                    aria-label={t.meldungen.status}
                    className="h-8 w-32 text-xs"
                    onChange={(e) =>
                      setzeStatus.mutate({
                        id: m.id,
                        status: e.target.value as FeedbackStatus,
                      })
                    }
                  >
                    <option value="neu">{t.meldungen.offen}</option>
                    <option value="erledigt">{t.meldungen.erledigt}</option>
                  </Select>
                  <ConfirmDeleteButton
                    itemLabel={t.meldungen.meldung}
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
        title={t.meldungen.aufnahme}
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
