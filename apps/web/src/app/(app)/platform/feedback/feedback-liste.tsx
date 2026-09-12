"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, RotateCcw } from "lucide-react";

import {
  feedbackApi,
  feedbackKeys,
  nachStatus,
  type Feedback,
  type FeedbackStatus,
} from "@/lib/feedback";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { cn } from "@/lib/cn";

type Ansicht = "tabelle" | "kanban";
const ANSICHTEN: Ansicht[] = ["tabelle", "kanban"];

/**
 * Was aus den Ansichten gemeldet wurde — als Tabelle wie im Altsystem
 * (`FeedbackPage`) oder als Kanban mit einer Spalte je Status (MEL-01).
 *
 * Beide Ansichten zeigen dieselbe Menge mit denselben Aktionen. Ob eine
 * Meldung **gesehen** ist, ist kein Status: offen/erledigt bilden die
 * Spalten, ungesehen ist ein Punkt an der Meldung. Als gesehen gilt sie, wenn
 * jemand den Punkt anklickt, das Bild öffnet oder den Status ändert — wie im
 * Altsystem, wo ein Klick auf die Zeile sie abhakt. Beim bloßen Öffnen der
 * Seite bleibt die Markierung stehen, sonst wäre sie beim nächsten Besuch weg,
 * ohne dass jemand die Meldung gelesen hat.
 *
 * Das Bild liegt im Eimer `feedback` und ist nicht öffentlich. Es wird erst
 * geholt, wenn jemand es ansieht — über eine signierte URL, die nach fünf
 * Minuten verfällt. Gelöscht wird über die Storage-API (`feedbackApi.loeschen`).
 */
export function FeedbackListe() {
  const t = useTexte();
  const w = t.meldungen;
  const format = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "short", timeStyle: "short" });
  const queryClient = useQueryClient();
  const [ansicht, setAnsicht] = useState<Ansicht>("tabelle");
  const [bild, setBild] = useState<{ url: string; seite: string } | null>(null);

  const liste = useQuery({ queryKey: feedbackKeys.liste(), queryFn: feedbackApi.liste });
  const daten = liste.data;
  const meldungen = useMemo(() => daten ?? [], [daten]);
  const offen = meldungen.filter((m) => m.status === "neu").length;
  const ungesehen = meldungen.filter((m) => m.gesehen_am === null).length;

  // Auch die Zahl an der Glocke in der Kopfzeile.
  const neuLaden = async () => {
    await queryClient.invalidateQueries({ queryKey: feedbackKeys.liste() });
    await queryClient.invalidateQueries({ queryKey: feedbackKeys.offen() });
  };

  const gesehen = useMutation({
    mutationFn: (m: Feedback) => feedbackApi.gesehen([m.id]),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });
  const merke = (m: Feedback) => {
    if (m.gesehen_am === null) gesehen.mutate(m);
  };

  const setzeStatus = useMutation({
    mutationFn: ({ m, status }: { m: Feedback; status: FeedbackStatus }) => feedbackApi.status(m.id, status),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (m: Feedback) => feedbackApi.loeschen(m.id, m.bild_pfad),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const zeigeBild = useMutation({
    mutationFn: async (m: Feedback) => ({ url: await feedbackApi.bildUrl(m.bild_pfad!), seite: m.seite }),
    onSuccess: setBild,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const statusName = (s: FeedbackStatus) => (s === "neu" ? w.offen : w.erledigt);

  const punkt = (m: Feedback) =>
    m.gesehen_am === null ? (
      <button
        type="button"
        onClick={() => merke(m)}
        aria-label={`${w.ungesehen} — ${w.alsGesehen}`}
        title={w.alsGesehen}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
      >
        <span className="h-2 w-2 rounded-full bg-[var(--fg)]" />
      </button>
    ) : (
      <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
    );

  const bildKnopf = (m: Feedback) =>
    m.bild_pfad ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          merke(m);
          zeigeBild.mutate(m);
        }}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        {w.oeffnen}
      </Button>
    ) : (
      <span className="text-xs text-[var(--fg-muted)]">—</span>
    );

  const aktionen = (m: Feedback) => (
    <div className="flex items-center justify-end gap-1">
      {m.status === "neu" ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={w.alsErledigt}
          title={w.alsErledigt}
          onClick={() => {
            merke(m);
            setzeStatus.mutate({ m, status: "erledigt" });
          }}
        >
          <Check className="h-4 w-4" aria-hidden />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={w.wiederOeffnen}
          title={w.wiederOeffnen}
          onClick={() => {
            merke(m);
            setzeStatus.mutate({ m, status: "neu" });
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </Button>
      )}
      <ConfirmDeleteButton itemLabel={w.meldung} onConfirm={() => loeschen.mutateAsync(m)} />
    </div>
  );

  const spalten: Tabellenspalte<Feedback>[] = [
    {
      schluessel: "datum",
      titel: w.spalte.datum,
      typ: "datum",
      wert: (m) => m.erstellt_am,
      suchtext: (m) => format.format(new Date(m.erstellt_am)),
      className: "whitespace-nowrap text-xs text-[var(--fg-muted)]",
      zelle: (m) => (
        <span className="inline-flex items-center gap-1.5">
          {punkt(m)}
          {format.format(new Date(m.erstellt_am))}
        </span>
      ),
    },
    {
      schluessel: "von",
      titel: w.spalte.von,
      typ: "text",
      wert: (m) => m.melder_email ?? w.unbekannt,
      className: "text-xs",
    },
    {
      schluessel: "seite",
      titel: w.spalte.seite,
      typ: "text",
      wert: (m) => m.seite,
      className: "max-w-40 truncate font-mono text-xs",
      zelle: (m) => <span title={m.seite}>{m.seite}</span>,
    },
    {
      schluessel: "beschreibung",
      titel: w.spalte.beschreibung,
      typ: "text",
      wert: (m) => m.beschreibung,
      className: "max-w-sm whitespace-pre-wrap",
    },
    {
      // Sortiert Meldungen mit Bild vor oder hinter die ohne.
      schluessel: "screenshot",
      titel: w.spalte.screenshot,
      typ: "zahl",
      wert: (m) => (m.bild_pfad ? 1 : 0),
      suchtext: false,
      zelle: bildKnopf,
    },
    {
      schluessel: "status",
      titel: w.spalte.status,
      typ: "text",
      wert: (m) => statusName(m.status),
      zelle: (m) => <Badge variant={m.status === "neu" ? "default" : "secondary"}>{statusName(m.status)}</Badge>,
    },
    {
      schluessel: "aktionen",
      titel: w.spalte.aktionen,
      typ: "text",
      wert: () => null,
      suchtext: false,
      sortierbar: false,
      ausrichtung: "end",
      zelle: aktionen,
    },
  ];

  const spaltenKanban = nachStatus(meldungen);

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={
          <>
            {w.stand(offen)}
            {ungesehen > 0 && w.neuSeit(ungesehen)}
          </>
        }
        links={
          <div
            role="radiogroup"
            aria-label={w.ansicht}
            className="inline-flex rounded-md border border-[var(--border)] p-0.5"
          >
            {ANSICHTEN.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={ansicht === a}
                onClick={() => setAnsicht(a)}
                className={cn(
                  "rounded px-4 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
                  ansicht === a ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
                )}
              >
                {a === "tabelle" ? w.tabelle : w.kanban}
              </button>
            ))}
          </div>
        }
      />

      {liste.error && <Card className="p-4 text-sm text-[var(--danger)]">{(liste.error as Error).message}</Card>}

      {!liste.isLoading && meldungen.length === 0 ? (
        <EmptyState title={w.nichtsGemeldet} body={w.nichtsGemeldetText} />
      ) : ansicht === "tabelle" ? (
        <Datentabelle
          zeilen={meldungen}
          spalten={spalten}
          zeilenSchluessel={(m) => m.id}
          laedt={liste.isLoading}
          beschriftung={t.pfad.seiten["/platform/feedback"]}
          zeilenKlasse={(m) => (m.gesehen_am === null ? "bg-[var(--muted)]" : undefined)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(["neu", "erledigt"] as const).map((status) => (
            <section key={status} aria-label={statusName(status)} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                {statusName(status)}
                <span className="text-[var(--fg-muted)]">({spaltenKanban[status].length})</span>
              </h3>
              <ul className="space-y-2">
                {spaltenKanban[status].map((m) => (
                  <li key={m.id}>
                    <Card
                      className={cn(
                        "space-y-2 p-3",
                        m.gesehen_am === null && "border-s-2 border-s-[var(--fg)] bg-[var(--muted)]",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {punkt(m)}
                        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{m.beschreibung}</p>
                      </div>
                      <p className="text-xs text-[var(--fg-muted)]">
                        {m.melder_email ?? w.unbekannt} · <span className="font-mono">{m.seite}</span> ·{" "}
                        {format.format(new Date(m.erstellt_am))}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        {bildKnopf(m)}
                        {aktionen(m)}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={bild !== null}
        onOpenChange={(o) => !o && setBild(null)}
        title={w.aufnahme}
        description={bild?.seite}
        className="w-[min(72rem,calc(100vw-2rem))]"
      >
        {bild && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bild.url}
            alt={`${w.aufnahme}: ${bild.seite}`}
            className="max-h-[70vh] w-full rounded-md border border-[var(--border)] object-contain"
          />
        )}
      </Dialog>
    </div>
  );
}
