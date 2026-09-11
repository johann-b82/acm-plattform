"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { BEREICH_LABEL } from "@/lib/zielwerte";
import {
  STATUS_LABEL,
  bewertungApi,
  bewertungKeys,
  type MassnahmeStatus,
} from "@/lib/kpi/bewertung";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Der KVP-Kreis auf den Kennzahlen: kommentieren, Maßnahme ableiten, bis zur
 * Erledigung verfolgen.
 *
 * Links die Kennzahlen mit ihrem Stand, rechts die gewählte im Detail. Die
 * Liste kommt aus `zielwerte` — wer eine Kennzahl mit Zielwert anlegt, kann
 * sie damit auch bewerten.
 */

const STATUS_FOLGE: MassnahmeStatus[] = ["offen", "laeuft", "erledigt", "verworfen"];

function datum(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function BewertungSeite({ darfSchreiben }: { darfSchreiben: boolean }) {
  const qc = useQueryClient();
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [neuerKommentar, setNeuerKommentar] = useState("");
  const [neueMassnahme, setNeueMassnahme] = useState({ titel: "", zustaendig: "", faellig_am: "" });

  const uebersicht = useQuery({
    queryKey: bewertungKeys.uebersicht(),
    queryFn: bewertungApi.uebersicht,
  });

  // Eigenes useMemo: sonst ist `zeilen` bei jedem Rendern ein neues Array und
  // das useMemo weiter unten rechnet umsonst.
  const daten = uebersicht.data;
  const zeilen = useMemo(() => daten ?? [], [daten]);
  const aktiv = gewaehlt ?? zeilen[0]?.schluessel ?? null;
  const aktivZeile = zeilen.find((z) => z.schluessel === aktiv);

  const kommentare = useQuery({
    queryKey: bewertungKeys.kommentare(aktiv ?? ""),
    queryFn: () => bewertungApi.kommentare(aktiv!),
    enabled: !!aktiv,
  });
  const massnahmen = useQuery({
    queryKey: bewertungKeys.massnahmen(aktiv ?? ""),
    queryFn: () => bewertungApi.massnahmen(aktiv!),
    enabled: !!aktiv,
  });

  function nachAenderung() {
    qc.invalidateQueries({ queryKey: bewertungKeys.uebersicht() });
    if (aktiv) {
      qc.invalidateQueries({ queryKey: bewertungKeys.kommentare(aktiv) });
      qc.invalidateQueries({ queryKey: bewertungKeys.massnahmen(aktiv) });
    }
  }

  const kommentarAnlegen = useMutation({
    mutationFn: (text: string) => bewertungApi.kommentarAnlegen(aktiv!, text),
    onSuccess: () => {
      setNeuerKommentar("");
      nachAenderung();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const kommentarLoeschen = useMutation({
    mutationFn: bewertungApi.kommentarLoeschen,
    onSuccess: nachAenderung,
    onError: (e: Error) => toast.error(e.message),
  });
  const massnahmeAnlegen = useMutation({
    mutationFn: () =>
      bewertungApi.massnahmeAnlegen(aktiv!, {
        titel: neueMassnahme.titel,
        zustaendig: neueMassnahme.zustaendig,
        faellig_am: neueMassnahme.faellig_am || null,
      }),
    onSuccess: () => {
      setNeueMassnahme({ titel: "", zustaendig: "", faellig_am: "" });
      nachAenderung();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const statusSetzen = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MassnahmeStatus }) =>
      bewertungApi.massnahmeStatus(id, status),
    onSuccess: nachAenderung,
    onError: (e: Error) => toast.error(e.message),
  });
  const massnahmeLoeschen = useMutation({
    mutationFn: bewertungApi.massnahmeLoeschen,
    onSuccess: nachAenderung,
    onError: (e: Error) => toast.error(e.message),
  });

  const nachBereich = useMemo(() => {
    const m = new Map<string, typeof zeilen>();
    for (const z of zeilen) m.set(z.bereich, [...(m.get(z.bereich) ?? []), z]);
    return [...m.entries()];
  }, [zeilen]);

  const heute = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/kpi"
          className="inline-flex items-center gap-1 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" /> KPI-Dashboard
        </Link>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">KPI-Bewertung</h2>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
          Kommentieren, was eine Zahl bedeutet, und festhalten, was daraus folgt. Die Liste
          sind die Kennzahlen mit Zielwert — dieselbe Liste, die auch die Dashboards prägt.
        </p>
      </div>

      {uebersicht.error && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Übersicht konnte nicht geladen werden: {(uebersicht.error as Error).message}
        </Card>
      )}

      {!darfSchreiben && (
        <Card className="p-4 text-sm text-[var(--fg-muted)]">
          Du kannst Bewertungen lesen, aber nicht schreiben. Dafür braucht es das Recht
          {" "}{"„Bearbeiten“"} auf den Einstellungen.
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <nav className="space-y-4">
          {nachBereich.map(([bereich, werte]) => (
            <div key={bereich}>
              <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                {BEREICH_LABEL[bereich] ?? bereich}
              </h2>
              <ul className="space-y-1">
                {werte.map((z) => (
                  <li key={z.schluessel}>
                    <button
                      type="button"
                      onClick={() => setGewaehlt(z.schluessel)}
                      aria-current={z.schluessel === aktiv}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm",
                        z.schluessel === aktiv
                          ? "bg-[var(--fg)] text-[var(--bg)]"
                          : "hover:bg-[var(--muted)]",
                      )}
                    >
                      <span className="truncate">{z.label}</span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                        {z.kommentare > 0 && (
                          <span className="inline-flex items-center gap-0.5 opacity-70">
                            <MessageSquare className="h-3 w-3" />
                            {z.kommentare}
                          </span>
                        )}
                        {z.offen > 0 && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5",
                              z.ueberfaellig > 0
                                ? "bg-[var(--danger)] text-white"
                                : z.schluessel === aktiv
                                  ? "bg-[var(--bg)] text-[var(--fg)]"
                                  : "bg-[var(--muted)]",
                            )}
                            title={
                              z.ueberfaellig > 0
                                ? `${z.ueberfaellig} überfällig`
                                : `${z.offen} offen`
                            }
                          >
                            {z.offen}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {aktiv && aktivZeile && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">{aktivZeile.label}</h2>
              <p className="text-sm text-[var(--fg-muted)]">
                {aktivZeile.offen} offen, davon {aktivZeile.ueberfaellig} überfällig ·{" "}
                {aktivZeile.erledigt} erledigt · {aktivZeile.kommentare}{" "}
                {aktivZeile.kommentare === 1 ? "Kommentar" : "Kommentare"}
              </p>
            </div>

            <Card className="p-5">
              <h3 className="font-medium">Maßnahmen</h3>
              {darfSchreiben && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_10rem_9rem_auto]">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="titel">Was ist zu tun</Label>
                    <Input
                      id="titel"
                      value={neueMassnahme.titel}
                      onChange={(e) =>
                        setNeueMassnahme((v) => ({ ...v, titel: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="zustaendig">Zuständig</Label>
                    <Input
                      id="zustaendig"
                      value={neueMassnahme.zustaendig}
                      onChange={(e) =>
                        setNeueMassnahme((v) => ({ ...v, zustaendig: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="faellig">Fällig</Label>
                    <Input
                      id="faellig"
                      type="date"
                      min={heute}
                      value={neueMassnahme.faellig_am}
                      onChange={(e) =>
                        setNeueMassnahme((v) => ({ ...v, faellig_am: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      disabled={!neueMassnahme.titel.trim() || massnahmeAnlegen.isPending}
                      onClick={() => massnahmeAnlegen.mutate()}
                    >
                      Anlegen
                    </Button>
                  </div>
                </div>
              )}

              <ul className="mt-4 divide-y divide-[var(--border)]">
                {(massnahmen.data ?? []).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.titel}</div>
                      <div className="text-xs text-[var(--fg-muted)]">
                        {m.zustaendig || "ohne Zuständigen"} · fällig {datum(m.faellig_am)}
                        {m.erledigt_am && ` · erledigt ${datum(m.erledigt_am)}`}
                      </div>
                    </div>
                    {darfSchreiben ? (
                      <select
                        value={m.status}
                        onChange={(e) =>
                          statusSetzen.mutate({
                            id: m.id,
                            status: e.target.value as MassnahmeStatus,
                          })
                        }
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                      >
                        {STATUS_FOLGE.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-[var(--fg-muted)]">
                        {STATUS_LABEL[m.status]}
                      </span>
                    )}
                    {darfSchreiben && (
                      <button
                        type="button"
                        aria-label="Maßnahme löschen"
                        onClick={() => massnahmeLoeschen.mutate(m.id)}
                        className="rounded p-1 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!massnahmen.isLoading && (massnahmen.data?.length ?? 0) === 0 && (
                <p className="mt-4 text-sm text-[var(--fg-muted)]">
                  Noch keine Maßnahme zu dieser Kennzahl.
                </p>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="font-medium">Kommentare</h3>
              {darfSchreiben && (
                <div className="mt-3 flex gap-2">
                  <Input
                    value={neuerKommentar}
                    placeholder="Was sagt diese Zahl?"
                    onChange={(e) => setNeuerKommentar(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && neuerKommentar.trim()) {
                        kommentarAnlegen.mutate(neuerKommentar.trim());
                      }
                    }}
                  />
                  <Button
                    disabled={!neuerKommentar.trim() || kommentarAnlegen.isPending}
                    onClick={() => kommentarAnlegen.mutate(neuerKommentar.trim())}
                  >
                    Speichern
                  </Button>
                </div>
              )}
              <ul className="mt-4 space-y-3">
                {(kommentare.data ?? []).map((k) => (
                  <li key={k.id} className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-sm">{k.text}</p>
                      <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                        {datum(k.erstellt_am)}
                      </p>
                    </div>
                    {darfSchreiben && (
                      <button
                        type="button"
                        aria-label="Kommentar löschen"
                        onClick={() => kommentarLoeschen.mutate(k.id)}
                        className="rounded p-1 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!kommentare.isLoading && (kommentare.data?.length ?? 0) === 0 && (
                <p className="mt-4 text-sm text-[var(--fg-muted)]">
                  Noch nichts gesagt zu dieser Kennzahl.
                </p>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
