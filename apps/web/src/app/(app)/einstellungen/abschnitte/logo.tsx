"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import { logoApi, logoKeys } from "@/lib/logo";
import { Card } from "@/components/ui/primitives";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * Das Firmenlogo — oben links in der Anwendung und auf jedem Formblatt.
 *
 * Nur PNG oder JPEG. Das Altprojekt lässt zusätzlich SVG zu und muss es dafür
 * reinigen, weil eine SVG-Datei Skripte tragen kann — gebraucht wird das Logo
 * aber nur in den Formblättern, und dort lässt sich ohnehin kein SVG
 * einbetten. Der Fall entfällt, statt behandelt zu werden.
 */
export function Logo() {
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
      toast.success("Logo hinterlegt.");
      return queryClient.invalidateQueries({ queryKey: ["logo"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-medium">Firmenlogo</h3>
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">
        Steht oben links in der Anwendung und in der Kopfzeile jedes erzeugten
        Formblatts — Einarbeitungsplan, Wartungsnachweis, Schulungsübersicht,
        Zeugnis. PNG oder JPEG, höchstens 5 MB. Ist keins hinterlegt, steht dort
        der Schriftzug „ACM-Plattform“.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {vorschau ? (
          // Ein signierter Verweis auf eine hochgeladene Datei; `next/image`
          // bräuchte dafür eine Host-Freigabe und brächte hier nichts.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vorschau}
            alt="Das hinterlegte Firmenlogo"
            className="h-16 w-auto rounded border border-[var(--border)] bg-white p-2"
          />
        ) : (
          <span className="text-sm text-[var(--fg-muted)]">Noch keins hinterlegt.</span>
        )}
        <label
          className={
            "inline-flex h-9 cursor-pointer items-center rounded-md border " +
            "border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)] " +
            "focus-within:outline-2 focus-within:outline-[var(--ring)]"
          }
        >
          <FileUp className="mr-1.5 h-4 w-4" aria-hidden />
          {hochladen.isPending ? "Lädt …" : stand.data?.pfad ? "Ersetzen" : "Hochladen"}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-label="Firmenlogo hochladen"
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
