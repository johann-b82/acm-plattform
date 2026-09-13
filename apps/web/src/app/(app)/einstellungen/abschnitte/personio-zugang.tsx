"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlugZap, RefreshCw } from "lucide-react";

import { personioKeys, personioZugang } from "@/lib/personio-zugang";
import { plattformApi, plattformKeys } from "@/lib/plattform-einstellungen";
import { Button, Card, Input, Label, Select, Switch } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";

/** Die Auswahlwerte des Syncintervalls in Stunden; 0 heißt „nur manuell“. */
const INTERVALLE = [0, 1, 6, 24, 168] as const;

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
  const ZEIT = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], {
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

  // Takt und Nachweisübertragung stehen in den Plattform-Einstellungen (SET-08/09).
  const plattform = useQuery({ queryKey: plattformKeys.alle(), queryFn: plattformApi.lesen });
  const [kategorie, setKategorie] = useState<string | null>(null);
  const nachweisKategorie = kategorie ?? plattform.data?.personio_nachweis_kategorie ?? "";

  const taktSetzen = useMutation({
    mutationFn: (stunden: number) => plattformApi.personioTaktSetzen(stunden),
    onSuccess: () => {
      toast.success(worte.taktGespeichert);
      return queryClient.invalidateQueries({ queryKey: plattformKeys.alle() });
    },
    onError: (err: Error) => toast.error(worte.speichernFehler(err.message)),
  });

  const abgleich = useMutation({
    mutationFn: personioZugang.abgleichen,
    onSuccess: (e) => {
      if (e.status === "fehler") toast.error(worte.abgleichFehler(e.fehler ?? ""));
      else if (e.status === "teilweise") toast.warning(worte.abgleichTeilweise(e.mitarbeiter, e.fehler ?? ""));
      else toast.success(worte.abgleichFertig(e.mitarbeiter, e.anwesenheiten, e.abwesenheiten));
    },
    onError: (err: Error) => toast.error(worte.abgleichFehler(err.message)),
  });

  const nachweisSetzen = useMutation({
    mutationFn: ({ aktiv, kat }: { aktiv: boolean; kat: string }) =>
      plattformApi.nachweisSetzen(aktiv, kat),
    onSuccess: () => {
      toast.success(worte.nachweisGespeichert);
      setKategorie(null);
      return queryClient.invalidateQueries({ queryKey: plattformKeys.alle() });
    },
    onError: (err: Error) => toast.error(worte.speichernFehler(err.message)),
  });

  const daten = stand.data;
  const vollstaendig = kennung.trim() !== "" && geheimnis.trim() !== "";
  const takt = plattform.data?.personio_sync_intervall_h ?? 24;
  const nachweisAktiv = plattform.data?.personio_nachweis_aktiv ?? false;

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
          <PlugZap className="me-1 h-4 w-4" aria-hidden />
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

      {/* Syncintervall und manueller Abgleich (SET-08). */}
      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <h4 className="text-sm font-medium">{worte.abgleichTitel}</h4>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{worte.abgleichHinweis}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="personio-intervall">{worte.intervall}</Label>
            <Select
              id="personio-intervall"
              value={String(takt)}
              disabled={plattform.isLoading || taktSetzen.isPending}
              onChange={(e) => taktSetzen.mutate(Number(e.target.value))}
              className="w-56"
            >
              {INTERVALLE.map((h) => (
                <option key={h} value={h}>
                  {worte.intervallWahl[String(h) as keyof typeof worte.intervallWahl]}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={!daten?.gesetzt || abgleich.isPending}
            onClick={() => abgleich.mutate()}
          >
            <RefreshCw className={"me-1.5 h-4 w-4" + (abgleich.isPending ? " animate-spin" : "")} aria-hidden />
            {abgleich.isPending ? worte.abgleichLaeuft : worte.abgleichJetzt}
          </Button>
        </div>
      </div>

      {/* Optionale Nachweisübertragung, standardmäßig aus (SET-09). */}
      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <h4 className="text-sm font-medium">{worte.nachweisTitel}</h4>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{worte.nachweisHinweis}</p>
        <div className="mt-3">
          <Switch
            checked={nachweisAktiv}
            label={worte.nachweisAktiv}
            disabled={plattform.isLoading || nachweisSetzen.isPending}
            onCheckedChange={(an) => nachweisSetzen.mutate({ aktiv: an, kat: nachweisKategorie })}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="personio-kategorie">{worte.nachweisKategorie}</Label>
            <Input
              id="personio-kategorie"
              value={nachweisKategorie}
              onChange={(e) => setKategorie(e.target.value)}
              className="w-56"
              placeholder={worte.nachweisKategoriePlatzhalter}
            />
          </div>
          <Button
            variant="outline"
            disabled={nachweisSetzen.isPending || kategorie === null}
            onClick={() => nachweisSetzen.mutate({ aktiv: nachweisAktiv, kat: nachweisKategorie })}
          >
            {worte.speichern}
          </Button>
        </div>
      </div>
    </Card>
  );
}
