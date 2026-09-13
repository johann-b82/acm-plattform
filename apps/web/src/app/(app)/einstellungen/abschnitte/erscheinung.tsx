"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { useTexte } from "@/components/sprache/anbieter";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { plattformApi, plattformKeys } from "@/lib/plattform-einstellungen";
import {
  STANDARD_ERSCHEINUNG,
  istHexfarbe,
  pruefeKontraste,
  type Erscheinung,
  type Farbrollen,
  type Thema,
} from "@/lib/kontrast";

/**
 * App-Name und Farbrollen (SET-06).
 *
 * Keine starre Palette: die Hauptfarbe (Fokus, Links, Primärknopf, Hauptreihe
 * der Diagramme) und die Schrift darauf, je einmal für hell und dunkel. Beim
 * Tippen prüft eine reine Funktion die tatsächlichen Kombinationen nach
 * WCAG 2.2; unzureichende werden benannt, blockieren das Speichern aber nicht —
 * die Warnung sagt, welcher Bereich betroffen ist.
 */
export function Erscheinung() {
  const worte = useTexte();
  const e = worte.einstellungenText;
  const queryClient = useQueryClient();

  const stand = useQuery({ queryKey: plattformKeys.alle(), queryFn: plattformApi.lesen });
  const [name, setName] = useState<string | null>(null);
  const [farben, setFarben] = useState<Erscheinung | null>(null);

  const appName = name ?? stand.data?.app_name ?? "ACM-Plattform";
  const erscheinung = farben ?? stand.data?.erscheinung ?? STANDARD_ERSCHEINUNG;

  const pruefungen = useMemo(() => pruefeKontraste(erscheinung), [erscheinung]);
  const maengel = pruefungen.filter((p) => !p.bestanden);

  const speichern = useMutation({
    mutationFn: () => plattformApi.erscheinungSetzen(appName, erscheinung),
    onSuccess: () => {
      toast.success(e.farbenGespeichert);
      setName(null);
      setFarben(null);
      return queryClient.invalidateQueries({ queryKey: plattformKeys.alle() });
    },
    onError: (fehler: Error) => toast.error(e.speichernFehler(fehler.message)),
  });

  const zuruecksetzen = useMutation({
    mutationFn: () => plattformApi.erscheinungSetzen(appName, null),
    onSuccess: () => {
      toast.success(e.farbenAufVorgabe);
      setFarben(null);
      return queryClient.invalidateQueries({ queryKey: plattformKeys.alle() });
    },
    onError: (fehler: Error) => toast.error(e.speichernFehler(fehler.message)),
  });

  function setzeFarbe(thema: Thema, feld: keyof Farbrollen, wert: string) {
    setFarben((alt) => {
      const basis = alt ?? erscheinung;
      return { ...basis, [thema]: { ...basis[thema], [feld]: wert } };
    });
  }

  const nameLeer = appName.trim() === "";

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h3 className="font-medium">{e.appName}</h3>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{e.appNameHinweis}</p>
        <Input
          value={appName}
          onChange={(ev) => setName(ev.target.value)}
          className="mt-2 max-w-xs"
          aria-label={e.appName}
          maxLength={60}
        />
      </div>

      <div>
        <h3 className="font-medium">{e.farbrollen}</h3>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{e.farbrollenHinweis}</p>

        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          {(["hell", "dunkel"] as const).map((thema) => (
            <div key={thema} className="space-y-3">
              <p className="text-sm font-medium">{thema === "hell" ? e.hellTitel : e.dunkelTitel}</p>
              <Farbfeld
                label={e.hauptfarbe}
                wert={erscheinung[thema].hauptfarbe}
                onChange={(w) => setzeFarbe(thema, "hauptfarbe", w)}
              />
              <Farbfeld
                label={e.textAufHauptfarbe}
                wert={erscheinung[thema].textAufHauptfarbe}
                onChange={(w) => setzeFarbe(thema, "textAufHauptfarbe", w)}
              />
            </div>
          ))}
        </div>
      </div>

      {maengel.length > 0 && (
        <div className="space-y-1 rounded-md border border-[var(--warn)] bg-[color-mix(in_oklab,var(--warn)_10%,transparent)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--warn)]">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {e.kontrastTitel}
          </p>
          <ul className="space-y-0.5 text-sm text-[var(--fg-muted)]">
            {maengel.map((m) => (
              <li key={`${m.thema}-${m.bereich}`}>
                {e.kontrastZeile(
                  m.thema === "hell" ? e.hellTitel : e.dunkelTitel,
                  e.kontrastBereiche[m.bereich],
                  m.verhaeltnis.toFixed(2),
                  m.mindestens.toLocaleString("de-DE", { minimumFractionDigits: 1 }),
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={nameLeer || speichern.isPending || stand.isLoading}
          onClick={() => speichern.mutate()}
        >
          {speichern.isPending ? e.speichert : e.speichern}
        </Button>
        <Button
          variant="outline"
          disabled={zuruecksetzen.isPending || stand.isLoading}
          onClick={() => zuruecksetzen.mutate()}
        >
          {e.farbenZuruecksetzen}
        </Button>
      </div>
    </Card>
  );
}

function Farbfeld({
  label,
  wert,
  onChange,
}: {
  label: string;
  wert: string;
  onChange: (wert: string) => void;
}) {
  const gueltig = istHexfarbe(wert);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={gueltig ? wert : "#000000"}
        onChange={(ev) => onChange(ev.target.value.toUpperCase())}
        aria-label={label}
        className="h-9 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <Label className="text-xs text-[var(--fg-muted)]">{label}</Label>
        <Input
          value={wert}
          onChange={(ev) => onChange(ev.target.value.toUpperCase())}
          className="h-8 font-mono text-xs uppercase"
          aria-invalid={!gueltig}
          maxLength={7}
        />
      </div>
    </div>
  );
}
