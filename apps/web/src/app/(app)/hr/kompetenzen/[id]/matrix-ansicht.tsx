"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import {
  gruppiere,
  istLuecke,
  kompetenzApi,
  kompetenzKeys,
  zellenschluessel,
  type Bewertung,
  type MatrixPerson,
  type Qualifikation,
  type Stand,
} from "@/lib/kompetenzen";
import { Badge, Button, Card, EmptyState, Input, Label, Select } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { cn } from "@/lib/cn";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { useKompetenzbereich, useStufentext } from "@/lib/tafeln";
import { Klappbar } from "../../klappbar";

/**
 * Eine Kompetenzmatrix.
 *
 * Beim Öffnen eine Leseansicht (KOM-03): Werte stehen da, aber nichts ist
 * editierbar und keine Löschaktion sichtbar. Erst „Bearbeiten“ gibt die
 * Felder und das Ergänzen frei; gespeichert wird dann je Zelle sofort, wie im
 * Altsystem — einen gesonderten Speichern-/Verwerfen-Schritt gibt es dort
 * nicht. Die Berechtigung ist davon unabhängig: wer nicht schreiben darf,
 * sieht den Knopf gar nicht erst.
 *
 * Die Qualifikationen sind nach Gruppe klappbar (KOM-04); Überschrift und
 * Anzahl bleiben sichtbar, die Personenspalten und die Zellzuordnung ändern
 * sich beim Klappen nicht. Statt eines Seitenzählers ist die Gruppe die
 * Einheit, in der die (bis zu 196) Zeilen der Matrix gebündelt und
 * strukturtreu handhabbar bleiben.
 */
export function MatrixAnsicht({ id, darfSchreiben }: { id: string; darfSchreiben: boolean }) {
  const worte = useTexte();
  const bereichLabel = useKompetenzbereich();
  const stufentext = useStufentext();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [neu, setNeu] = useState({ bezeichnung: "", kategorie: "" });
  const [neuePerson, setNeuePerson] = useState("");

  const matrizen = useQuery({ queryKey: kompetenzKeys.matrizen(), queryFn: kompetenzApi.matrizen });
  const qualifikationen = useQuery({
    queryKey: kompetenzKeys.qualifikationen(id),
    queryFn: () => kompetenzApi.qualifikationen(id),
  });
  const personen = useQuery({ queryKey: kompetenzKeys.personen(id), queryFn: () => kompetenzApi.personen(id) });
  const bewertungen = useQuery({ queryKey: kompetenzKeys.bewertungen(id), queryFn: () => kompetenzApi.bewertungen(id) });
  const stand = useQuery({ queryKey: kompetenzKeys.stand(id), queryFn: () => kompetenzApi.stand(id) });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["kompetenzen"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const zelle = useMutation({
    mutationFn: (w: { qualifikation_id: string; person_id: string; anforderungslevel: number | null; erfuellungsgrad: number | null }) =>
      kompetenzApi.zelleSetzen(w.qualifikation_id, w.person_id, w.anforderungslevel, w.erfuellungsgrad),
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
    for (const b of bewertungen.data ?? []) m.set(zellenschluessel(b.qualifikation_id, b.person_id), b);
    return m;
  }, [bewertungen.data]);
  const standNach = useMemo(() => {
    const m = new Map<string, Stand>();
    for (const s of stand.data ?? []) m.set(s.qualifikation_id, s);
    return m;
  }, [stand.data]);
  const gruppen = useMemo(() => gruppiere(qualifikationen.data ?? []), [qualifikationen.data]);

  const matrix = (matrizen.data ?? []).find((m) => m.id === id);
  const spalten = personen.data ?? [];

  if (matrizen.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>;
  }
  if (!matrix) {
    return <EmptyState title={worte.matrix.gibtEsNicht} body={worte.matrix.gibtEsNichtText} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{matrix.titel ?? matrix.blatt}</h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            <Badge variant="outline">{bereichLabel[matrix.bereich]}</Badge>{" "}
            {worte.matrix.blattStand(matrix.blatt)}
            {matrix.stand && worte.matrix.stand(DATUM.format(new Date(matrix.stand)))}
            {worte.matrix.umfang((qualifikationen.data ?? []).length, spalten.length)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {darfSchreiben && (
            <Button
              variant={bearbeiten ? "default" : "outline"}
              aria-pressed={bearbeiten}
              onClick={() => setBearbeiten((v) => !v)}
            >
              <Pencil className="me-1.5 h-4 w-4" aria-hidden />
              {bearbeiten ? worte.matrix.bearbeitenFertig : worte.matrix.bearbeiten}
            </Button>
          )}
          <Link href="/hr/kompetenzen" className="text-sm underline-offset-4 hover:underline">
            {worte.matrix.zurUebersicht}
          </Link>
        </div>
      </div>

      {(qualifikationen.data ?? []).length === 0 ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.matrix.keineZeilen}</Card>
      ) : (
        gruppen.map((gruppe, i) => (
          <Klappbar
            key={gruppe.kategorie ?? "__ohne"}
            titel={gruppe.kategorie ?? worte.matrix.ohneKategorie}
            anzahl={gruppe.zeilen.length}
            offenStart={i === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-max min-w-full border-collapse text-sm" aria-label={gruppe.kategorie ?? worte.matrix.ohneKategorie}>
                <thead>
                  <tr>
                    <th className="sticky start-0 z-10 min-w-64 border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium">
                      {worte.matrix.qualifikation}
                    </th>
                    <th className="border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-end font-medium">Ø</th>
                    {spalten.map((p) => (
                      <th key={p.id} className="border-b border-[var(--border)] bg-[var(--muted)] px-2 py-2 text-start font-medium">
                        <div className="flex w-28 items-start gap-1">
                          <span className={cn(!p.employee_id && "text-[var(--fg-muted)]")}>{p.name}</span>
                          {bearbeiten && (
                            <ConfirmDeleteButton itemLabel={p.name} onConfirm={() => personWeg.mutateAsync(p).then(() => undefined)} />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gruppe.zeilen.map((q) => {
                    const s = standNach.get(q.id);
                    return (
                      <tr key={q.id}>
                        <td className="sticky start-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                          <div className="flex items-center gap-2">
                            {q.nr !== null && <span className="w-6 tabular-nums text-[var(--fg-muted)]">{q.nr}</span>}
                            <span>{q.bezeichnung}</span>
                            {bearbeiten && (
                              <span className="ms-auto">
                                <ConfirmDeleteButton itemLabel={q.bezeichnung} onConfirm={() => qualifikationWeg.mutateAsync(q).then(() => undefined)} />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="border-b border-[var(--border)] px-3 py-2 text-end tabular-nums text-[var(--fg-muted)]">
                          {s?.schnitt ?? "—"}
                        </td>
                        {spalten.map((p) => {
                          const wert = zellen.get(zellenschluessel(q.id, p.id));
                          return bearbeiten ? (
                            <ZelleBearbeiten
                              key={p.id}
                              wert={wert}
                              setzen={(level, grad) =>
                                zelle.mutate({ qualifikation_id: q.id, person_id: p.id, anforderungslevel: level, erfuellungsgrad: grad })
                              }
                            />
                          ) : (
                            <ZelleAnzeige key={p.id} wert={wert} />
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Klappbar>
        ))
      )}

      <Card className="space-y-2 p-5">
        <h2 className="font-medium">{worte.matrix.stufenBedeuten}</h2>
        <ul className="grid gap-1 text-sm text-[var(--fg-muted)] sm:grid-cols-2">
          {Object.entries(stufentext).map(([stufe, text]) => (
            <li key={stufe}>
              <span className="font-medium text-[var(--fg)]">{stufe}</span> — {text}
            </li>
          ))}
        </ul>
        <p className="text-sm text-[var(--fg-muted)]">{worte.matrix.erfuellungsgradHinweis}</p>
      </Card>

      {bearbeiten && (
        <Card className="space-y-4 p-5">
          <h2 className="font-medium">{worte.matrix.ergaenzen}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="bezeichnung">{worte.matrix.neueQualifikation}</Label>
              <Input
                id="bezeichnung"
                value={neu.bezeichnung}
                placeholder={worte.matrix.beispiel}
                onChange={(e) => setNeu({ ...neu, bezeichnung: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kategorie">{worte.matrix.kategorie}</Label>
              <Select id="kategorie" value={neu.kategorie} onChange={(e) => setNeu({ ...neu, kategorie: e.target.value })}>
                <option value="">{worte.matrix.ohne}</option>
                {[...new Set((qualifikationen.data ?? []).map((q) => q.kategorie).filter(Boolean))].map((k) => (
                  <option key={k} value={k as string}>
                    {k}
                  </option>
                ))}
              </Select>
            </div>
            <Button disabled={!neu.bezeichnung.trim() || qualifikationAnlegen.isPending} onClick={() => qualifikationAnlegen.mutate()}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {worte.matrix.zeile}
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="neue-person">{worte.matrix.neuePerson}</Label>
              <Input
                id="neue-person"
                value={neuePerson}
                placeholder={worte.matrix.namensform}
                onChange={(e) => setNeuePerson(e.target.value)}
              />
            </div>
            <Button variant="outline" disabled={!neuePerson.trim() || personAnlegen.isPending} onClick={() => personAnlegen.mutate()}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {worte.matrix.spalte}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Leseansicht einer Zelle: gefordert und erfüllt, ohne Eingabe. */
function ZelleAnzeige({ wert }: { wert: Bewertung | undefined }) {
  const luecke = istLuecke(wert);
  const leer = !wert || (wert.anforderungslevel === null && wert.erfuellungsgrad === null);
  return (
    <td
      className={cn(
        "border-b border-s border-[var(--border)] px-2 py-2 text-center tabular-nums",
        luecke && "bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]",
      )}
    >
      {leer ? (
        <span className="text-[var(--fg-muted)]">·</span>
      ) : (
        <span className="inline-flex items-center gap-1">
          {wert!.anforderungslevel !== null && (
            <span className="rounded bg-[var(--muted)] px-1 text-xs text-[var(--fg-muted)]">{wert!.anforderungslevel}</span>
          )}
          {wert!.erfuellungsgrad !== null && <span>{wert!.erfuellungsgrad}</span>}
        </span>
      )}
    </td>
  );
}

/** Bearbeiten-Zelle: gefordert und erfüllt, zwei kleine Felder. Speichert je Zelle. */
function ZelleBearbeiten({
  wert,
  setzen,
}: {
  wert: Bewertung | undefined;
  setzen: (level: number | null, grad: number | null) => void;
}) {
  const worte = useTexte();
  const luecke = istLuecke(wert);

  function zahl(roh: string, oben: number): number | null {
    const text = roh.trim();
    if (text === "") return null;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0 || n > oben) return null;
    return Math.round(n);
  }

  return (
    <td className={cn("border-b border-s border-[var(--border)] px-1 py-1", luecke && "bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]")}>
      <div className="flex w-24 gap-1">
        <Input
          aria-label={worte.matrix.anforderungslevel}
          className="h-8 w-10 px-1 text-center tabular-nums"
          defaultValue={wert?.anforderungslevel ?? ""}
          onBlur={(e) => {
            const level = zahl(e.target.value, 4);
            if (level !== (wert?.anforderungslevel ?? null)) setzen(level, wert?.erfuellungsgrad ?? null);
          }}
        />
        <Input
          aria-label={worte.matrix.erfuellungsgrad}
          className="h-8 w-12 px-1 text-center tabular-nums"
          defaultValue={wert?.erfuellungsgrad ?? ""}
          onBlur={(e) => {
            const grad = zahl(e.target.value, 100);
            if (grad !== (wert?.erfuellungsgrad ?? null)) setzen(wert?.anforderungslevel ?? null, grad);
          }}
        />
      </div>
    </td>
  );
}
