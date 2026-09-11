"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileDown, Plus } from "lucide-react";

import {
  istNeu,
  onboardingApi,
  onboardingKeys,
  type Eintritt,
  type Planzeile,
} from "@/lib/onboarding";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

const LEER = { name: "", abteilung: "", position: "", eintritt: "" };

/**
 * Die Eintritte und ihr Schulungsplan.
 *
 * Der Plan kommt aus der Datenbank: `schulungsplan(employee_id)` verbindet
 * Anforderungsmatrix, Rollenzuordnung und Bestand. Fehlt die Zuordnung
 * Position → Abteilungskürzel, meldet die Funktion das als eigene Zeile —
 * ohne diesen Hinweis entstünden unbemerkt zu wenige Pflichtschulungen.
 */
export function Eintritte({ darfSchreiben }: { darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState<number | null>(null);
  const [neu, setNeu] = useState({ ...LEER });
  const [neueRolle, setNeueRolle] = useState({ position: "", kuerzel: "" });
  const [nurNeue, setNurNeue] = useState(true);

  const eintritte = useQuery({
    queryKey: onboardingKeys.eintritte(),
    queryFn: onboardingApi.eintritte,
  });
  const rollen = useQuery({ queryKey: onboardingKeys.rollen(), queryFn: onboardingApi.rollen });
  const plan = useQuery({
    queryKey: onboardingKeys.plan(offen ?? 0),
    queryFn: () => onboardingApi.plan(offen!),
    enabled: offen !== null,
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const planAnlegen = useMutation({
    mutationFn: (employee_id: number) => onboardingApi.planAnlegen(employee_id),
    onSuccess: (anzahl) => {
      toast.success(
        anzahl === 0
          ? "Es fehlte nichts."
          : `${anzahl} ${anzahl === 1 ? "Schulung" : "Schulungen"} angelegt.`,
      );
      queryClient.invalidateQueries({ queryKey: ["schulungen"] });
      return neuLaden();
    },
    onError: melde,
  });

  const abteilung = useMutation({
    mutationFn: (w: { employee_id: number; abteilung: string | null }) =>
      onboardingApi.abteilungSetzen(w.employee_id, w.abteilung),
    onSuccess: neuLaden,
    onError: melde,
  });

  const paket = useMutation({
    mutationFn: (e: Eintritt) => onboardingApi.paketVermerken(e),
    onSuccess: () => {
      toast.success("Übergabe vermerkt.");
      return neuLaden();
    },
    onError: melde,
  });

  // Das Paket zu erzeugen **ist** die Übergabe: die Route vermerkt sie selbst.
  // Deshalb danach neu laden — die „neu"-Markierung verschwindet dabei.
  const paketDrucken = useMutation({
    mutationFn: (e: Eintritt) => onboardingApi.paket(e),
    onSuccess: neuLaden,
    onError: melde,
  });

  const uebersichtDrucken = useMutation({
    mutationFn: (e: Eintritt) => onboardingApi.uebersicht(e),
    onError: melde,
  });

  const externAnlegen = useMutation({
    mutationFn: () =>
      onboardingApi.externAnlegen({
        name: neu.name.trim(),
        abteilung: neu.abteilung.trim() || null,
        position: neu.position.trim() || null,
        eintritt: neu.eintritt || null,
      }),
    onSuccess: () => {
      setNeu({ ...LEER });
      return neuLaden();
    },
    onError: melde,
  });

  const externWeg = useMutation({
    mutationFn: (id: string) => onboardingApi.externLoeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const rolleSetzen = useMutation({
    mutationFn: () =>
      onboardingApi.rolleSetzen(neueRolle.position.trim(), neueRolle.kuerzel.trim()),
    onSuccess: () => {
      setNeueRolle({ position: "", kuerzel: "" });
      return neuLaden();
    },
    onError: melde,
  });

  const rolleWeg = useMutation({
    mutationFn: (id: string) => onboardingApi.rolleLoeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const liste = useMemo(() => {
    const alle = eintritte.data ?? [];
    return nurNeue ? alle.filter((e) => istNeu(e)) : alle;
  }, [eintritte.data, nurNeue]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Wer neu ist und welche Schulungen die Anforderungsmatrix für ihn
            verlangt. Der Plan wird nicht gespeichert, sondern gerechnet —
            ändert sich die Matrix, ändert sich der Plan.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/hr/dokumente" className="underline-offset-4 hover:underline">
            Dokumentenlauf
          </Link>
          <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
            Schulungen
          </Link>
          <Link href="/hr" className="underline-offset-4 hover:underline">
            Personal
          </Link>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Button
          size="sm"
          variant={nurNeue ? "default" : "outline"}
          onClick={() => setNurNeue(true)}
        >
          Neu (letzte 90 Tage)
        </Button>
        <Button
          size="sm"
          variant={nurNeue ? "outline" : "default"}
          onClick={() => setNurNeue(false)}
        >
          Alle
        </Button>
        <span className="text-sm text-[var(--fg-muted)]">
          {liste.length} {liste.length === 1 ? "Person" : "Personen"}
        </span>
      </Card>

      {eintritte.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title="Keine Eintritte"
          body="Sobald jemand mit Eintrittsdatum aus Personio kommt, steht er hier."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Abteilung</Th>
                <Th>Position</Th>
                <Th>Eintritt</Th>
                <Th>Übergabe</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {liste.map((e) => (
                <tr key={e.employee_id ?? e.extern_id}>
                  <Td>
                    {e.name}
                    {e.extern_id && (
                      <Badge variant="outline" className="ml-2">
                        nicht in Personio
                      </Badge>
                    )}
                    {istNeu(e) && <Badge className="ml-2">neu</Badge>}
                  </Td>
                  <Td>
                    {e.employee_id !== null ? (
                      <Input
                        defaultValue={e.abteilung ?? ""}
                        placeholder="—"
                        disabled={!darfSchreiben}
                        title={
                          e.abteilung_gesetzt
                            ? "Hier gesetzt — übersteuert Personio"
                            : "Aus Personio"
                        }
                        onBlur={(ev) => {
                          const wert = ev.target.value.trim() || null;
                          if (wert !== (e.abteilung ?? null)) {
                            abteilung.mutate({ employee_id: e.employee_id!, abteilung: wert });
                          }
                        }}
                      />
                    ) : (
                      (e.abteilung ?? "—")
                    )}
                  </Td>
                  <Td>{e.position ?? "—"}</Td>
                  <Td>{e.eintritt ? DATUM.format(new Date(e.eintritt)) : "—"}</Td>
                  <Td>
                    {e.heruntergeladen_am ? (
                      DATUM.format(new Date(e.heruntergeladen_am))
                    ) : darfSchreiben ? (
                      <Button size="sm" variant="outline" onClick={() => paket.mutate(e)}>
                        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Vermerken
                      </Button>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        title="Einarbeitungsplan und Schulungsübersicht als ein PDF"
                        disabled={paketDrucken.isPending}
                        onClick={() => paketDrucken.mutate(e)}
                      >
                        <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Paket
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Nur die Schulungsübersicht (Formblatt 71)"
                        disabled={uebersichtDrucken.isPending}
                        onClick={() => uebersichtDrucken.mutate(e)}
                      >
                        Übersicht
                      </Button>
                      {e.employee_id !== null ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setOffen(offen === e.employee_id ? null : e.employee_id)
                          }
                        >
                          {offen === e.employee_id ? "Plan zu" : "Plan"}
                        </Button>
                      ) : (
                        darfSchreiben && (
                          <ConfirmDeleteButton
                            itemLabel={e.name}
                            onConfirm={() =>
                              externWeg.mutateAsync(e.extern_id!).then(() => undefined)
                            }
                          />
                        )
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {offen !== null && (
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">Schulungsplan</h2>
            {darfSchreiben && (
              <Button
                disabled={planAnlegen.isPending}
                onClick={() => planAnlegen.mutate(offen)}
              >
                Fehlende anlegen
              </Button>
            )}
          </div>
          {plan.isLoading ? (
            <p className="text-sm text-[var(--fg-muted)]">wird gerechnet …</p>
          ) : (
            <Planliste zeilen={plan.data ?? []} />
          )}
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-medium">Position → Abteilungskürzel</h2>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Die Brücke zwischen Personio und der feinen Ebene der
            Anforderungsmatrix. Ohne Eintrag greift die feine Ebene für diese
            Position nicht — der Plan sagt das dann ausdrücklich.
          </p>
        </div>
        {(rollen.data ?? []).length > 0 && (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {(rollen.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span>{r.position}</span>
                <Badge variant="outline">{r.abteilung_kuerzel}</Badge>
                {darfSchreiben && (
                  <span className="ml-auto">
                    <ConfirmDeleteButton
                      itemLabel={r.position}
                      onConfirm={() => rolleWeg.mutateAsync(r.id).then(() => undefined)}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {darfSchreiben && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="position">Position</Label>
              <Input
                id="position"
                value={neueRolle.position}
                placeholder="z. B. CNC Fräser"
                onChange={(e) => setNeueRolle({ ...neueRolle, position: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kuerzel">Kürzel</Label>
              <Input
                id="kuerzel"
                className="w-28"
                value={neueRolle.kuerzel}
                placeholder="CNC"
                onChange={(e) => setNeueRolle({ ...neueRolle, kuerzel: e.target.value })}
              />
            </div>
            <Button
              variant="outline"
              disabled={!neueRolle.position.trim() || !neueRolle.kuerzel.trim()}
              onClick={() => rolleSetzen.mutate()}
            >
              Zuordnen
            </Button>
          </div>
        )}
      </Card>

      {darfSchreiben && (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="font-medium">Person ohne Personio</h2>
            <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
              Für Eintritte, die noch nicht im Abgleich stehen — oder gar nicht
              dorthin gehören.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <Label htmlFor="extern-name">Name</Label>
              <Input
                id="extern-name"
                value={neu.name}
                onChange={(e) => setNeu({ ...neu, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="extern-abteilung">Abteilung</Label>
              <Input
                id="extern-abteilung"
                className="w-40"
                value={neu.abteilung}
                onChange={(e) => setNeu({ ...neu, abteilung: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="extern-position">Position</Label>
              <Input
                id="extern-position"
                className="w-40"
                value={neu.position}
                onChange={(e) => setNeu({ ...neu, position: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="extern-eintritt">Eintritt</Label>
              <Input
                id="extern-eintritt"
                type="date"
                value={neu.eintritt}
                onChange={(e) => setNeu({ ...neu, eintritt: e.target.value })}
              />
            </div>
            <Button
              disabled={!neu.name.trim() || externAnlegen.isPending}
              onClick={() => externAnlegen.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Anlegen
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Soll und Ist nebeneinander — samt dem Hinweis, wenn eine Ebene nicht greift. */
function Planliste({ zeilen }: { zeilen: Planzeile[] }) {
  const hinweis = zeilen.find((z) => z.quelle === "kuerzel_fehlt");
  const echte = zeilen.filter((z) => z.quelle !== "kuerzel_fehlt");

  return (
    <div className="space-y-3">
      {hinweis && (
        <p className="rounded-md bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-3 text-sm">
          Für die Position {hinweis.abteilung ? `„${hinweis.abteilung}“ ` : ""}ist kein
          Abteilungskürzel hinterlegt. Die feine Ebene der Anforderungsmatrix
          greift für diese Person deshalb nicht — es fehlen möglicherweise
          Pflichtschulungen.
        </p>
      )}
      {echte.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">
          Die Anforderungsmatrix verlangt für diese Abteilung nichts.
        </p>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Schulung</Th>
                <Th>Bereich</Th>
                <Th>Turnus</Th>
                <Th>Pflicht über</Th>
                <Th>Stand</Th>
              </tr>
            </thead>
            <tbody>
              {echte.map((z) => (
                <tr key={`${z.schulung_id}-${z.quelle}`}>
                  <Td>{z.name}</Td>
                  <Td>{z.bereich}</Td>
                  <Td>{z.turnus ?? "—"}</Td>
                  <Td>
                    <Badge variant="outline">
                      {z.quelle === "personio" ? "Abteilung" : "Kürzel"} {z.abteilung}
                    </Badge>
                  </Td>
                  <Td>
                    {z.vorhanden ? (
                      <Badge variant="secondary">vorhanden</Badge>
                    ) : (
                      <Badge>fehlt</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
