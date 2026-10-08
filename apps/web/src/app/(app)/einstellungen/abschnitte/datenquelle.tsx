"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { useSprache, useTexte } from "@/components/sprache/anbieter";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Switch,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { plattformApi, plattformKeys, type Datenquelle as DQ } from "@/lib/plattform-einstellungen";
import {
  istOnline,
  useSyncLaeufe,
  useWorkerKonfig,
  useWorkerStatus,
  workerApi,
  workerKeys,
  WORKER_ARTEN,
} from "@/lib/odbc-worker";
import { ZAHL_TAG } from "@/lib/sprache";
import { cn } from "@/lib/cn";

const WERTE: DQ[] = ["extrakte", "odbc"];

/**
 * Woher die Kennzahlen kommen (Umschalter), **und** Steuerung/Überwachung des
 * ODBC-Workers. Der Umschalter ist sofort gespeichert; bei „ODBC" sperrt die
 * compute-Seite die manuellen Importe (409). Darunter: der Worker meldet seinen
 * Herzschlag und die letzten Läufe (Push), und holt Intervall/aktive Arten/
 * Sofort-Sync von hier (Pull) — die VM braucht nur ausgehende Verbindungen.
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
    <div className="space-y-4">
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

      <WorkerPanel />
    </div>
  );
}

/** Steuerung und Überwachung der Apollo-VM. Nur `platform:admin` sieht die
 *  Tabellen (RLS); für andere bleiben die Abfragen leer und das Panel ruhig. */
function WorkerPanel() {
  const w = useTexte().einstellungenText.datenquelle.worker;
  const ZEIT = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], {
    dateStyle: "short",
    timeStyle: "short",
  });
  const queryClient = useQueryClient();

  const konfig = useWorkerKonfig();
  const status = useWorkerStatus();
  const laeufe = useSyncLaeufe();

  const [intervall, setIntervall] = useState<string>("");
  const intervallWert = konfig.data?.intervall_min ?? 60;
  const aktiveArten = konfig.data?.aktive_arten ?? [];

  const invalidieren = () => queryClient.invalidateQueries({ queryKey: workerKeys.konfig() });
  const fehler = (e: Error) => toast.error(e.message);

  const intervallSpeichern = useMutation({
    mutationFn: (min: number) => workerApi.intervallSetzen(min),
    onSuccess: () => {
      toast.success(w.gespeichert);
      setIntervall("");
      return invalidieren();
    },
    onError: fehler,
  });

  const artenSpeichern = useMutation({
    mutationFn: (arten: string[]) => workerApi.artenSetzen(arten),
    onSuccess: invalidieren,
    onError: fehler,
  });

  const syncJetzt = useMutation({
    mutationFn: () => workerApi.syncJetzt(),
    onSuccess: () => {
      toast.success(w.syncAngefordert);
      return invalidieren();
    },
    onError: fehler,
  });

  const online = istOnline(status.data ?? null, intervallWert);
  const gesehen = status.data?.gesehen_am;
  const laufProArt = new Map((laeufe.data ?? []).map((l) => [l.art, l]));
  // Sofort-Sync noch nicht bestätigt?
  const angefordert = konfig.data?.sync_angefordert_am;
  const bestaetigt = status.data?.sync_bestaetigt_am;
  const syncLaeuft =
    !!angefordert && (!bestaetigt || new Date(bestaetigt) < new Date(angefordert));

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-medium">{w.titel}</h3>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{w.hinweis}</p>
      </div>

      {/* Herzschlag */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Badge className={online ? "bg-[var(--ok)]/15 text-[var(--ok)]" : "bg-[var(--fg-muted)]/15 text-[var(--fg-muted)]"}>
          {online ? w.online : w.offline}
        </Badge>
        <span className="text-[var(--fg-muted)]">
          {gesehen ? w.zuletzt(ZEIT.format(new Date(gesehen))) : w.nieGesehen}
        </span>
        {status.data?.worker_version && (
          <span className="text-[var(--fg-muted)]">
            {w.version}: {status.data.worker_version}
          </span>
        )}
        {status.data?.host && (
          <span className="text-[var(--fg-muted)]">
            {w.host}: {status.data.host}
          </span>
        )}
      </div>
      {status.data?.letzter_fehler && (
        <p className="text-sm text-[var(--warn)]">
          {w.letzterFehler}: {status.data.letzter_fehler}
        </p>
      )}

      {/* Intervall + Sofort-Sync */}
      <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="odbc-intervall">{w.intervall}</Label>
          <Input
            id="odbc-intervall"
            type="number"
            min={5}
            max={1440}
            className="w-28"
            placeholder={String(intervallWert)}
            value={intervall}
            onChange={(e) => setIntervall(e.target.value)}
          />
        </div>
        <span className="pb-2 text-xs text-[var(--fg-muted)]">{w.intervallEinheit}</span>
        <Button
          variant="outline"
          disabled={intervall === "" || intervallSpeichern.isPending}
          onClick={() => {
            const n = Number(intervall);
            if (Number.isFinite(n) && n >= 5 && n <= 1440) intervallSpeichern.mutate(Math.round(n));
          }}
        >
          {w.speichern}
        </Button>
        <Button
          disabled={syncJetzt.isPending || syncLaeuft}
          onClick={() => syncJetzt.mutate()}
        >
          <RefreshCw className={cn("me-1.5 h-4 w-4", syncLaeuft && "animate-spin")} aria-hidden />
          {syncLaeuft ? w.syncAngefordert : w.syncJetzt}
        </Button>
      </div>

      {/* Aktive Arten */}
      <div className="border-t border-[var(--border)] pt-4">
        <h4 className="text-sm font-medium">{w.arten}</h4>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{w.artenHinweis}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WORKER_ARTEN.map((art) => {
            const an = aktiveArten.includes(art);
            return (
              <Switch
                key={art}
                checked={an}
                label={art}
                disabled={konfig.isLoading || artenSpeichern.isPending}
                onCheckedChange={(ein) =>
                  artenSpeichern.mutate(
                    ein ? [...aktiveArten, art] : aktiveArten.filter((a) => a !== art),
                  )
                }
              />
            );
          })}
        </div>
      </div>

      {/* Läufe je Art */}
      <div className="border-t border-[var(--border)] pt-4">
        {(laeufe.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">{w.keineLaeufe}</p>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{w.spalteArt}</Th>
                  <Th>{w.spalteStand}</Th>
                  <Th>{w.spalteStatus}</Th>
                  <Th className="text-end">{w.spalteZeilen}</Th>
                  <Th className="text-end">{w.spalteDauer}</Th>
                  <Th>{w.spalteFehler}</Th>
                </tr>
              </thead>
              <tbody>
                {WORKER_ARTEN.filter((a) => laufProArt.has(a)).map((art) => {
                  const l = laufProArt.get(art)!;
                  return (
                    <tr key={art}>
                      <Td>{art}</Td>
                      <Td>{ZEIT.format(new Date(l.gelaufen_am))}</Td>
                      <Td>
                        <Badge
                          className={
                            l.status === "ok"
                              ? "bg-[var(--ok)]/15 text-[var(--ok)]"
                              : "bg-[var(--warn)]/15 text-[var(--warn)]"
                          }
                        >
                          {l.status === "ok" ? w.statusOk : w.statusFehler}
                        </Badge>
                      </Td>
                      <Td className="text-end tabular-nums">{l.zeilen ?? "—"}</Td>
                      <Td className="text-end tabular-nums">
                        {l.dauer_ms != null ? `${(l.dauer_ms / 1000).toFixed(1)} s` : "—"}
                      </Td>
                      <Td className="max-w-[16rem] truncate text-[var(--warn)]" title={l.fehler ?? ""}>
                        {l.fehler ?? ""}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>
    </Card>
  );
}
