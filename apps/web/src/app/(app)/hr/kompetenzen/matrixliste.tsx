"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import {
  BEREICHE,
  BEREICH_LABEL,
  kompetenzApi,
  kompetenzKeys,
  type Bereich,
  type ImportErgebnis,
} from "@/lib/kompetenzen";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Label,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * Die Qualifikationsmatrizen.
 *
 * Der Import zeigt erst, was er täte. Das ist hier keine Höflichkeit: er
 * ersetzt ein Blatt vollständig, und wer danach in der Oberfläche gepflegt
 * hat, verlöre das.
 */
export function Matrixliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const [bereich, setBereich] = useState<Bereich>("produktion");
  const [vorschau, setVorschau] = useState<{ datei: File; ergebnis: ImportErgebnis } | null>(
    null,
  );

  const matrizen = useQuery({
    queryKey: kompetenzKeys.matrizen(),
    queryFn: kompetenzApi.matrizen,
  });

  const zeigen = useMutation({
    mutationFn: (datei: File) =>
      kompetenzApi.vorschau(bereich, datei).then((ergebnis) => ({ datei, ergebnis })),
    onSuccess: setVorschau,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const uebernehmen = useMutation({
    mutationFn: () => kompetenzApi.uebernehmen(bereich, vorschau!.datei),
    onSuccess: (e) => {
      setVorschau(null);
      toast.success(
        `${e.matrizen.length} ${e.matrizen.length === 1 ? "Blatt" : "Blätter"} übernommen.`,
      );
      return queryClient.invalidateQueries({ queryKey: ["kompetenzen"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const liste = matrizen.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kompetenzen</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Was eine Stelle verlangt und wie weit es erfüllt ist — je Bereich
            eine Matrix. Eingelesen aus der Bereichsdatei, danach hier
            gepflegt.
          </p>
        </div>
        <Link href="/hr" className="text-sm underline-offset-4 hover:underline">
          Zum Personal-Dashboard
        </Link>
      </div>

      {darfSchreiben && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bereich">Bereich</Label>
              <Select
                id="bereich"
                value={bereich}
                onChange={(e) => {
                  setBereich(e.target.value as Bereich);
                  setVorschau(null);
                }}
              >
                {BEREICHE.map((b) => (
                  <option key={b.wert} value={b.wert}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
            <label
              className={
                "inline-flex h-9 cursor-pointer items-center rounded-md border " +
                "border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)] " +
                "focus-within:outline-2 focus-within:outline-[var(--ring)]"
              }
            >
              <FileUp className="mr-1.5 h-4 w-4" aria-hidden />
              {zeigen.isPending ? "Wird gelesen …" : "Bereichsdatei einlesen"}
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                aria-label="Bereichsdatei einlesen"
                disabled={zeigen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) zeigen.mutate(datei);
                }}
              />
            </label>
          </div>

          {vorschau && (
            <div className="space-y-3 rounded-md bg-[var(--muted)] p-4 text-sm">
              <p className="font-medium">
                {vorschau.ergebnis.dateiname} — so sähe {BEREICH_LABEL[bereich]} danach aus:
              </p>
              <ul className="space-y-2">
                {vorschau.ergebnis.matrizen.map((m) => (
                  <li key={m.blatt}>
                    <span className="font-medium">{m.blatt}</span>: {m.qualifikationen}{" "}
                    Qualifikationen, {m.personen} Personen, {m.bewertungen} Bewertungen.{" "}
                    {m.zugeordnet} von {m.personen} Personen in Personio gefunden
                    {m.platzhalter > 0 &&
                      `, ${m.platzhalter} ${
                        m.platzhalter === 1 ? "Platzhalterspalte" : "Platzhalterspalten"
                      }`}
                    .
                    {m.nicht_zugeordnet.length > 0 && (
                      <span className="text-[var(--fg-muted)]">
                        {" "}
                        Ohne Zuordnung: {m.nicht_zugeordnet.join(", ")}.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {vorschau.ergebnis.hinweise.map((h) => (
                <p key={h} className="text-[var(--fg-muted)]">
                  {h}
                </p>
              ))}
              <p className="text-[var(--fg-muted)]">
                Die betroffenen Blätter werden vollständig ersetzt — hier
                gepflegte Änderungen gehen dabei verloren.
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={uebernehmen.isPending}
                  onClick={() => uebernehmen.mutate()}
                >
                  {uebernehmen.isPending ? "Wird übernommen …" : "Übernehmen"}
                </Button>
                <Button variant="outline" onClick={() => setVorschau(null)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {matrizen.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title="Noch keine Matrix"
          body="Lies eine Bereichsdatei ein — die Blätter darin werden je eine Matrix."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Bereich</Th>
                <Th>Blatt</Th>
                <Th>Titel</Th>
                <Th>Stand</Th>
                <Th>Eingelesen</Th>
              </tr>
            </thead>
            <tbody>
              {liste.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <Badge variant="outline">{BEREICH_LABEL[m.bereich]}</Badge>
                  </Td>
                  <Td>
                    <Link
                      href={`/hr/kompetenzen/${m.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {m.blatt}
                    </Link>
                  </Td>
                  <Td>{m.titel ?? "—"}</Td>
                  <Td>{m.stand ? DATUM.format(new Date(m.stand)) : "—"}</Td>
                  <Td>{DATUM.format(new Date(m.importiert_am))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
