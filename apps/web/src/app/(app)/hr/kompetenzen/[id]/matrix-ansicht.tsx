"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import {
  BEREICH_LABEL,
  LEVEL_TEXT,
  istLuecke,
  kompetenzApi,
  kompetenzKeys,
  zellenschluessel,
  type Bewertung,
  type MatrixPerson,
  type Qualifikation,
  type Stand,
} from "@/lib/kompetenzen";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { cn } from "@/lib/cn";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * Die Matrix als Raster.
 *
 * Bewusst kein `<Table>`-Baustein: die Kopfspalte muss beim Scrollen stehen
 * bleiben, sonst weiß bei dreißig Personen niemand mehr, welche Zeile er
 * gerade liest.
 */
export function MatrixAnsicht({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState({ bezeichnung: "", kategorie: "" });
  const [neuePerson, setNeuePerson] = useState("");

  const matrizen = useQuery({
    queryKey: kompetenzKeys.matrizen(),
    queryFn: kompetenzApi.matrizen,
  });
  const qualifikationen = useQuery({
    queryKey: kompetenzKeys.qualifikationen(id),
    queryFn: () => kompetenzApi.qualifikationen(id),
  });
  const personen = useQuery({
    queryKey: kompetenzKeys.personen(id),
    queryFn: () => kompetenzApi.personen(id),
  });
  const bewertungen = useQuery({
    queryKey: kompetenzKeys.bewertungen(id),
    queryFn: () => kompetenzApi.bewertungen(id),
  });
  const stand = useQuery({
    queryKey: kompetenzKeys.stand(id),
    queryFn: () => kompetenzApi.stand(id),
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["kompetenzen"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const zelle = useMutation({
    mutationFn: (w: {
      qualifikation_id: string;
      person_id: string;
      anforderungslevel: number | null;
      erfuellungsgrad: number | null;
    }) =>
      kompetenzApi.zelleSetzen(
        w.qualifikation_id,
        w.person_id,
        w.anforderungslevel,
        w.erfuellungsgrad,
      ),
    onSuccess: neuLaden,
    onError: melde,
  });

  const qualifikationAnlegen = useMutation({
    mutationFn: () =>
      kompetenzApi.qualifikationAnlegen(
        id,
        neu.bezeichnung.trim(),
        neu.kategorie.trim() || null,
        Math.max(0, ...(qualifikationen.data ?? []).map((q) => q.reihenfolge)) + 1,
      ),
    onSuccess: () => {
      setNeu({ bezeichnung: "", kategorie: neu.kategorie });
      return neuLaden();
    },
    onError: melde,
  });

  const qualifikationWeg = useMutation({
    mutationFn: (q: Qualifikation) => kompetenzApi.qualifikationLoeschen(q.id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const personAnlegen = useMutation({
    mutationFn: () =>
      kompetenzApi.personAnlegen(
        id,
        neuePerson.trim(),
        null,
        Math.max(0, ...(personen.data ?? []).map((p) => p.reihenfolge)) + 1,
      ),
    onSuccess: () => {
      setNeuePerson("");
      return neuLaden();
    },
    onError: melde,
  });

  const personWeg = useMutation({
    mutationFn: (p: MatrixPerson) => kompetenzApi.personLoeschen(p.id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const zellen = useMemo(() => {
    const m = new Map<string, Bewertung>();
    for (const b of bewertungen.data ?? []) {
      m.set(zellenschluessel(b.qualifikation_id, b.person_id), b);
    }
    return m;
  }, [bewertungen.data]);

  const standNach = useMemo(() => {
    const m = new Map<string, Stand>();
    for (const s of stand.data ?? []) m.set(s.qualifikation_id, s);
    return m;
  }, [stand.data]);

  const matrix = (matrizen.data ?? []).find((m) => m.id === id);
  const reihen = qualifikationen.data ?? [];
  const spalten = personen.data ?? [];

  if (matrizen.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>;
  }
  if (!matrix) {
    return <EmptyState title="Diese Matrix gibt es nicht" body="Vermutlich wurde sie ersetzt." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {matrix.titel ?? matrix.blatt}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            <Badge variant="outline">{BEREICH_LABEL[matrix.bereich]}</Badge>{" "}
            Blatt {matrix.blatt}
            {matrix.stand && ` · Stand ${DATUM.format(new Date(matrix.stand))}`} ·{" "}
            {reihen.length} Qualifikationen, {spalten.length} Personen
          </p>
        </div>
        <Link href="/hr/kompetenzen" className="text-sm underline-offset-4 hover:underline">
          Zur Übersicht
        </Link>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  className={
                    "sticky left-0 z-10 min-w-64 border-b border-[var(--border)] " +
                    "bg-[var(--muted)] px-3 py-2 text-left font-medium"
                  }
                >
                  Qualifikation
                </th>
                <th className="border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-right font-medium">
                  Ø
                </th>
                {spalten.map((p) => (
                  <th
                    key={p.id}
                    className="border-b border-[var(--border)] bg-[var(--muted)] px-2 py-2 text-left font-medium"
                  >
                    <div className="flex w-28 items-start gap-1">
                      <span className={cn(!p.employee_id && "text-[var(--fg-muted)]")}>
                        {p.name}
                      </span>
                      {darfSchreiben && (
                        <ConfirmDeleteButton
                          itemLabel={p.name}
                          onConfirm={() => personWeg.mutateAsync(p).then(() => undefined)}
                        />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reihen.map((q, i) => {
                const vorher = reihen[i - 1];
                const neueKategorie = q.kategorie && q.kategorie !== vorher?.kategorie;
                const s = standNach.get(q.id);
                return (
                  <Fragment key={q.id}>
                    {neueKategorie && (
                      <tr>
                        <td
                          colSpan={2 + spalten.length}
                          className="sticky left-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]"
                        >
                          {q.kategorie}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="sticky left-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                        <div className="flex items-center gap-2">
                          {q.nr !== null && (
                            <span className="w-6 tabular-nums text-[var(--fg-muted)]">
                              {q.nr}
                            </span>
                          )}
                          <span>{q.bezeichnung}</span>
                          {darfSchreiben && (
                            <span className="ml-auto">
                              <ConfirmDeleteButton
                                itemLabel={q.bezeichnung}
                                onConfirm={() =>
                                  qualifikationWeg.mutateAsync(q).then(() => undefined)
                                }
                              />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="border-b border-[var(--border)] px-3 py-2 text-right tabular-nums text-[var(--fg-muted)]">
                        {s?.schnitt ?? "—"}
                      </td>
                      {spalten.map((p) => (
                        <Zelle
                          key={p.id}
                          wert={zellen.get(zellenschluessel(q.id, p.id))}
                          darfSchreiben={darfSchreiben}
                          setzen={(level, grad) =>
                            zelle.mutate({
                              qualifikation_id: q.id,
                              person_id: p.id,
                              anforderungslevel: level,
                              erfuellungsgrad: grad,
                            })
                          }
                        />
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {reihen.length === 0 && (
          <p className="p-5 text-sm text-[var(--fg-muted)]">
            Diese Matrix hat noch keine Zeilen.
          </p>
        )}
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="font-medium">Was die Stufen bedeuten</h2>
        <ul className="grid gap-1 text-sm text-[var(--fg-muted)] sm:grid-cols-2">
          {Object.entries(LEVEL_TEXT).map(([stufe, text]) => (
            <li key={stufe}>
              <span className="font-medium text-[var(--fg)]">{stufe}</span> — {text}
            </li>
          ))}
        </ul>
        <p className="text-sm text-[var(--fg-muted)]">
          Die zweite Zahl ist der Erfüllungsgrad in Prozent. Eine Zelle mit
          Anforderung und weniger als 100 % ist eine Lücke und steht in
          Warnfarbe.
        </p>
      </Card>

      {darfSchreiben && (
        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Ergänzen</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="bezeichnung">Neue Qualifikation</Label>
              <Input
                id="bezeichnung"
                value={neu.bezeichnung}
                placeholder="z. B. Drehmaschine"
                onChange={(e) => setNeu({ ...neu, bezeichnung: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kategorie">Kategorie</Label>
              <Select
                id="kategorie"
                value={neu.kategorie}
                onChange={(e) => setNeu({ ...neu, kategorie: e.target.value })}
              >
                <option value="">ohne</option>
                {[...new Set(reihen.map((q) => q.kategorie).filter(Boolean))].map((k) => (
                  <option key={k} value={k as string}>
                    {k}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              disabled={!neu.bezeichnung.trim() || qualifikationAnlegen.isPending}
              onClick={() => qualifikationAnlegen.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Zeile
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="neue-person">Neue Person</Label>
              <Input
                id="neue-person"
                value={neuePerson}
                placeholder="Vorname Nachname"
                onChange={(e) => setNeuePerson(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={!neuePerson.trim() || personAnlegen.isPending}
              onClick={() => personAnlegen.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Spalte
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Eine Zelle: gefordert und erfüllt, zwei kleine Felder nebeneinander. */
function Zelle({
  wert,
  darfSchreiben,
  setzen,
}: {
  wert: Bewertung | undefined;
  darfSchreiben: boolean;
  setzen: (level: number | null, grad: number | null) => void;
}) {
  const luecke = istLuecke(wert);

  function zahl(roh: string, oben: number): number | null {
    const text = roh.trim();
    if (text === "") return null;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0 || n > oben) return null;
    return Math.round(n);
  }

  return (
    <td
      className={cn(
        "border-b border-l border-[var(--border)] px-1 py-1",
        luecke && "bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]",
      )}
    >
      <div className="flex w-24 gap-1">
        <Input
          aria-label="Anforderungslevel"
          className="h-8 w-10 px-1 text-center tabular-nums"
          defaultValue={wert?.anforderungslevel ?? ""}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const level = zahl(e.target.value, 4);
            if (level !== (wert?.anforderungslevel ?? null)) {
              setzen(level, wert?.erfuellungsgrad ?? null);
            }
          }}
        />
        <Input
          aria-label="Erfüllungsgrad in Prozent"
          className="h-8 w-12 px-1 text-center tabular-nums"
          defaultValue={wert?.erfuellungsgrad ?? ""}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const grad = zahl(e.target.value, 100);
            if (grad !== (wert?.erfuellungsgrad ?? null)) {
              setzen(wert?.anforderungslevel ?? null, grad);
            }
          }}
        />
      </div>
    </td>
  );
}
