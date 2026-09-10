"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Plus } from "lucide-react";

import { XLSX_TYP, atrApi, atrKeys, type ImportErgebnis, type Teil } from "@/lib/atr";
import {
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

/**
 * Der Teilekatalog: was ein Teil heißt, wiegt und zu welcher Zeichnung es
 * gehört. Ein Lieferschein findet sein Teil später über die normierte
 * Teilenummer — nur die Ziffern, weil sie auf dem Lieferschein anders
 * geschrieben steht als im Katalog.
 */
export function Teilekatalog({ darfSchreiben }: { darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const [suche, setSuche] = useState("");
  const [neueNummer, setNeueNummer] = useState("");
  const [bericht, setBericht] = useState<ImportErgebnis | null>(null);

  const teile = useQuery({
    queryKey: atrKeys.teile(suche),
    queryFn: () => atrApi.teile(suche),
  });
  const liste = teile.data ?? [];

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

  const einlesen = useMutation({
    mutationFn: (datei: File) => atrApi.referenzEinlesen(datei),
    onSuccess: (e) => {
      setBericht(e);
      toast.success(
        `${e.teile_neu} neu, ${e.teile_aktualisiert} aktualisiert.`,
      );
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const anlegen = useMutation({
    mutationFn: () => atrApi.teilAnlegen(neueNummer.trim()),
    onSuccess: () => {
      setNeueNummer("");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const aendern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Partial<Teil> }) =>
      atrApi.teilAendern(id, felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => atrApi.teilLoeschen(id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  /** Ein Feld, das beim Verlassen speichert. Die Liste ist breit; ein
   *  Speichern-Knopf je Zeile wäre mehr Klicks als Nutzen. */
  const Feld = ({
    teil,
    feld,
    breite,
    platzhalter,
  }: {
    teil: Teil;
    feld: keyof Teil;
    breite?: string;
    platzhalter?: string;
  }) => (
    <Input
      className={breite}
      defaultValue={(teil[feld] as string | null) ?? ""}
      placeholder={platzhalter}
      aria-label={`${feld} zu ${teil.teilenummer}`}
      disabled={!darfSchreiben}
      onBlur={(e) => {
        const wert = e.target.value.trim() || null;
        if (wert !== ((teil[feld] as string | null) ?? null)) {
          aendern.mutate({ id: teil.id, felder: { [feld]: wert } });
        }
      }}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-2xl font-semibold tracking-tight">ATR</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
          Der Teilekatalog ist die Grundlage: aus ihm holt ein Lieferschein
          Bezeichnung, Zeichnung und Gewicht. Gefunden wird über die
          Teilenummer ohne Beiwerk — nur die Ziffern zählen.
        </p>
        </div>
        <Link
          href="/atr/lieferungen"
          className="text-sm underline-offset-4 hover:underline"
        >
          Zu den Lieferungen
        </Link>
      </div>

      {darfSchreiben && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="neu">Teil von Hand anlegen</Label>
              <Input
                id="neu"
                value={neueNummer}
                placeholder="Teilenummer, z. B. VR-1234-56"
                onChange={(e) => setNeueNummer(e.target.value)}
              />
            </div>
            <Button
              disabled={!neueNummer.trim() || anlegen.isPending}
              onClick={() => anlegen.mutate()}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Anlegen
            </Button>
            <label
              className={
                "inline-flex h-9 cursor-pointer items-center rounded-md border " +
                "border-[var(--border)] px-4 text-sm font-medium " +
                "hover:bg-[var(--muted)] focus-within:outline-2 focus-within:outline-[var(--ring)]"
              }
            >
              <FileUp className="mr-2 h-4 w-4" aria-hidden />
              {einlesen.isPending ? "Wird gelesen …" : "Referenzmappe einlesen"}
              <input
                type="file"
                accept={`.xlsx,${XLSX_TYP}`}
                className="sr-only"
                aria-label="Referenzmappe einlesen"
                disabled={einlesen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) einlesen.mutate(datei);
                }}
              />
            </label>
          </div>

          {bericht && (
            <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
              <p>
                <span className="font-medium">{bericht.dateiname}</span>:{" "}
                {bericht.teile_gelesen} Teile gelesen, {bericht.teile_neu} neu,{" "}
                {bericht.teile_aktualisiert} aktualisiert
                {bericht.vorlage_uebernommen &&
                  ` · Vorlage ${bericht.programm} übernommen`}
                .
              </p>
              {bericht.hinweise.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-[var(--fg-muted)]">
                  {bericht.hinweise.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="suche">Suchen</Label>
        <Input
          id="suche"
          className="max-w-md"
          value={suche}
          placeholder="Teilenummer, Bezeichnung oder Zeichnung"
          onChange={(e) => setSuche(e.target.value)}
        />
      </div>

      {teile.isLoading && <p className="text-sm text-[var(--fg-muted)]">Wird geladen …</p>}

      {!teile.isLoading && liste.length === 0 && (
        <EmptyState
          title={suche ? "Nichts gefunden" : "Der Katalog ist leer"}
          body={
            suche
              ? "Kein Teil passt zu dieser Suche."
              : "Eine Referenzmappe einlesen oder ein Teil von Hand anlegen."
          }
        />
      )}

      {liste.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Teilenummer</Th>
                <Th>Bezeichnung</Th>
                <Th>Zeichnung</Th>
                <Th className="w-28">Gewicht kg</Th>
                <Th>Kategorie</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {liste.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Feld teil={t} feld="teilenummer" breite="w-44" />
                    <span className="mt-0.5 block text-xs tabular-nums text-[var(--fg-muted)]">
                      {t.teilenummer_norm ?? "keine Ziffern"}
                    </span>
                  </Td>
                  <Td>
                    <Feld teil={t} feld="bezeichnung" platzhalter="—" />
                  </Td>
                  <Td>
                    <Feld teil={t} feld="zeichnung" breite="w-40" platzhalter="—" />
                  </Td>
                  <Td>
                    <Feld teil={t} feld="gewicht_kg" breite="w-24" platzhalter="—" />
                  </Td>
                  <Td>
                    <Feld teil={t} feld="kategorie" breite="w-40" platzhalter="—" />
                  </Td>
                  <Td className="text-right">
                    {darfSchreiben && (
                      <ConfirmDeleteButton
                        itemLabel={t.teilenummer}
                        onConfirm={() =>
                          loeschen.mutateAsync(t.id).then(() => undefined)
                        }
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {liste.length === 500 && (
        <p className="text-xs text-[var(--fg-muted)]">
          Nur die ersten 500 Treffer — bitte enger suchen.
        </p>
      )}
    </div>
  );
}
