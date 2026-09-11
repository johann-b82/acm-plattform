"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlugZap } from "lucide-react";

import { personioKeys, personioZugang } from "@/lib/personio-zugang";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";

/**
 * Zugangsdaten eintragen, ohne an den Server zu müssen.
 *
 * Sie gehen den Weg der SNMP-Community: über `compute` hinein, verschlüsselt
 * in die Datenbank, und nie wieder heraus. Angezeigt wird deshalb nur, dass
 * etwas hinterlegt ist — wer sie wechseln will, trägt neue ein.
 *
 * Stehen sie in der Umgebung, sagt die Maske das und lässt sie stehen: ein
 * laufender Abgleich soll nicht dadurch aufhören, dass jemand hier vorbeischaut.
 */
export function PersonioZugang() {
  const worte = useTexte().personioZugang;
  const ZEIT = new Intl.DateTimeFormat(SPRACHE_TAG[useSprache()], {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const queryClient = useQueryClient();
  const [kennung, setKennung] = useState("");
  const [geheimnis, setGeheimnis] = useState("");

  const stand = useQuery({ queryKey: personioKeys.stand(), queryFn: personioZugang.stand });

  const speichern = useMutation({
    mutationFn: () => personioZugang.setzen(kennung.trim(), geheimnis.trim()),
    onSuccess: () => {
      setKennung("");
      setGeheimnis("");
      queryClient.invalidateQueries({ queryKey: personioKeys.stand() });
      toast.success(worte.gespeichert);
    },
    onError: (err: Error) => toast.error(worte.speichernFehler(err.message)),
  });

  const entfernen = useMutation({
    mutationFn: personioZugang.entfernen,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personioKeys.stand() });
      toast.success(worte.entfernt);
    },
    onError: (err: Error) => toast.error(worte.speichernFehler(err.message)),
  });

  const pruefen = useMutation({
    mutationFn: personioZugang.pruefen,
    onSuccess: (p) =>
      p.erreichbar
        ? toast.success(worte.verbindungSteht)
        : toast.error(p.meldung ?? worte.verbindungFehlt),
    onError: (err: Error) => toast.error(err.message),
  });

  const daten = stand.data;
  const vollstaendig = kennung.trim() !== "" && geheimnis.trim() !== "";

  return (
    <Card className="p-5">
      <h3 className="text-sm font-medium">{worte.titel}</h3>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">{worte.einleitung}</p>

      {daten && !daten.schluessel_bereit && (
        <p className="mt-2 text-sm text-[var(--warn)]">{worte.ohneSchluessel}</p>
      )}

      <p className="mt-3 text-sm">
        {!daten
          ? worte.laedt
          : daten.quelle === "datenbank"
            ? worte.hinterlegtSeit(
                ZEIT.format(new Date(daten.geaendert_am!)),
                daten.geaendert_von,
              )
            : daten.quelle === "umgebung"
              ? worte.ausDerUmgebung
              : worte.keineHinterlegt}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="personio-kennung">{worte.kennung}</Label>
          <Input
            id="personio-kennung"
            value={kennung}
            autoComplete="off"
            onChange={(e) => setKennung(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="personio-geheimnis">{worte.geheimnis}</Label>
          <Input
            id="personio-geheimnis"
            type="password"
            value={geheimnis}
            autoComplete="new-password"
            onChange={(e) => setGeheimnis(e.target.value)}
            className="w-64"
          />
        </div>
        <Button
          disabled={!vollstaendig || speichern.isPending}
          onClick={() => speichern.mutate()}
        >
          {worte.speichern}
        </Button>
      </div>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">{worte.feldHinweis}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!daten?.gesetzt || pruefen.isPending}
          onClick={() => pruefen.mutate()}
        >
          <PlugZap className="mr-1 h-4 w-4" aria-hidden />
          {pruefen.isPending ? worte.prueftGerade : worte.pruefen}
        </Button>
        {daten?.quelle === "datenbank" && (
          <ConfirmDeleteButton
            itemLabel={worte.titel}
            onConfirm={() => entfernen.mutate()}
            disabled={entfernen.isPending}
          />
        )}
      </div>
    </Card>
  );
}
