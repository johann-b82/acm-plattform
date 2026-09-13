"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import { logoApi, logoKeys, LOGO_TYPEN } from "@/lib/logo";
import { Card } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * Das Firmenlogo — oben links in der Anwendung und auf jedem Formblatt.
 *
 * PNG, JPEG oder SVG bis 5 MB (SET-07). Ein SVG wird in `compute` gereinigt
 * und für die Formblätter gerastert; der Upload geht deshalb über `compute`,
 * nicht direkt in den Eimer.
 */
export function Logo() {
  const worte = useTexte();
  const queryClient = useQueryClient();

  const stand = useQuery({ queryKey: logoKeys.stand(), queryFn: logoApi.stand });
  // Der signierte Verweis ist selbst eine Abfrage — kein Effekt, der Zustand
  // nachzieht. Er läuft nach fünf Minuten ab und wird dann neu geholt.
  const bild = useQuery({
    queryKey: [...logoKeys.stand(), "url", stand.data?.pfad],
    queryFn: () => logoApi.url(stand.data!),
    enabled: !!stand.data?.pfad,
    staleTime: 240_000,
  });
  const vorschau = bild.data ?? null;

  const hochladen = useMutation({
    mutationFn: (datei: File) => logoApi.hochladen(datei),
    onSuccess: () => {
      toast.success(worte.einstellungenText.logoHinterlegt);
      return queryClient.invalidateQueries({ queryKey: ["logo"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-medium">{worte.einstellungenText.firmenlogo}</h3>
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">
        {worte.einstellungenText.logoHinweis}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {vorschau ? (
          // Ein signierter Verweis auf eine hochgeladene Datei; `next/image`
          // bräuchte dafür eine Host-Freigabe und brächte hier nichts.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vorschau}
            alt={worte.einstellungenText.logoAlt}
            className="h-16 w-auto rounded border border-[var(--border)] bg-white p-2"
          />
        ) : (
          <span className="text-sm text-[var(--fg-muted)]">{worte.einstellungenText.keinsHinterlegt}</span>
        )}
        <label
          className={
            "inline-flex h-9 cursor-pointer items-center rounded-md border " +
            "border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)] " +
            "focus-within:outline-2 focus-within:outline-[var(--ring)]"
          }
        >
          <FileUp className="me-1.5 h-4 w-4" aria-hidden />
          {hochladen.isPending
            ? worte.einstellungenText.laedt
            : stand.data?.pfad
              ? worte.einstellungenText.ersetzen
              : worte.einstellungenText.hochladen}
          <input
            type="file"
            accept={LOGO_TYPEN.join(",")}
            className="sr-only"
            aria-label={worte.einstellungenText.logoHochladen}
            disabled={hochladen.isPending}
            onChange={(e) => {
              const datei = e.target.files?.[0];
              e.target.value = "";
              if (datei) hochladen.mutate(datei);
            }}
          />
        </label>
        {stand.data?.dateiname && (
          <span className="text-sm text-[var(--fg-muted)]">
            {stand.data.dateiname} · {DATUM.format(new Date(stand.data.geaendert_am))}
          </span>
        )}
      </div>
    </Card>
  );
}
