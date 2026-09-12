"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, FolderSearch } from "lucide-react";

import {
  lieferungApi,
  lieferungKeys,
  scanApi,
  type Lieferung,
  type LieferscheinErgebnis,
} from "@/lib/atr";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";



/**
 * Die eingelesenen Lieferscheine. Ein Entwurf wartet auf Durchsicht, eine
 * freigegebene Lieferung ist fertig — und ihre Positionen lassen sich dann
 * nicht mehr ändern (das hält die Datenbank, nicht diese Seite).
 */
export function Lieferungsliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [bericht, setBericht] = useState<LieferscheinErgebnis | null>(null);

  const lieferungen = useQuery({
    queryKey: lieferungKeys.liste(),
    queryFn: lieferungApi.liste,
  });
  const liste = lieferungen.data ?? [];

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

  // Derselbe Lauf wie der zeitgesteuerte, nur von Hand. Er steht hier und
  // nicht in den Einstellungen: einen liegen gebliebenen Lieferschein löst
  // aus, wer mit Lieferungen arbeitet, nicht die Plattform-Verwaltung.
  const durchsehen = useMutation({
    mutationFn: scanApi.lauf,
    onSuccess: (e) => {
      toast.success(
        e.gelesen === 0
          ? "Nichts im Eingang."
          : `${e.gelesen} gelesen, ${e.angelegt} angelegt.`,
      );
      for (const hinweis of e.hinweise) toast.error(hinweis);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const einlesen = useMutation({
    mutationFn: (datei: File) => lieferungApi.einlesen(datei),
    onSuccess: (e) => {
      setBericht(e);
      toast.success(
        `${e.positionen} Positionen, ${e.zugeordnet} im Katalog gefunden.`,
      );
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (l: Lieferung) => lieferungApi.loeschen(l.id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.lieferungen.einleitung}
        unter={
          <div className="mt-2 flex justify-start text-sm">
            <Link href="/atr" className="underline-offset-4 hover:underline">
              {worte.lieferungen.zumKatalog}
            </Link>
          </div>
        }
      />

      {darfSchreiben && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={
                "inline-flex h-9 cursor-pointer items-center rounded-md bg-[var(--fg)] " +
                "px-4 text-sm font-medium text-[var(--bg)] hover:opacity-90 " +
                "focus-within:outline-2 focus-within:outline-[var(--ring)]"
              }
            >
              <FileUp className="me-2 h-4 w-4" aria-hidden />
              {einlesen.isPending ? worte.lieferungen.wirdGelesen : worte.lieferungen.einlesen}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label={worte.lieferungen.einlesen}
                disabled={einlesen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) einlesen.mutate(datei);
                }}
              />
            </label>

            <Button
              variant="outline"
              onClick={() => durchsehen.mutate()}
              disabled={durchsehen.isPending}
            >
              <FolderSearch className="me-2 h-4 w-4" aria-hidden />
              {durchsehen.isPending ? worte.lieferungen.laeuft : worte.lieferungen.eingangDurchsehen}
            </Button>
          </div>

          {bericht && (
            <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
              <p>
                <span className="font-medium">{bericht.dateiname}</span>
                {bericht.lieferschein_nr && worte.lieferungen.berichtNummer(bericht.lieferschein_nr)}
                : {worte.lieferungen.berichtZeile(bericht.positionen, bericht.zugeordnet)}
              </p>
              <p className="mt-1 text-[var(--fg-muted)]">{bericht.programm_grund}</p>
              {bericht.hinweise.length > 0 && (
                <ul className="mt-1 list-disc ps-5 text-[var(--fg-muted)]">
                  {bericht.hinweise.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {lieferungen.isLoading && (
        <p className="text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</p>
      )}

      {!lieferungen.isLoading && liste.length === 0 && (
        <EmptyState
          title={worte.lieferungen.keinLieferschein}
          body={
            darfSchreiben
              ? worte.lieferungen.keinLieferscheinSchreiben
              : worte.lieferungen.keinLieferscheinLesen
          }
        />
      )}

      {liste.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.lieferungen.lieferschein}</Th>
                <Th>{worte.lieferungen.datum}</Th>
                <Th>{worte.lieferungen.programm}</Th>
                <Th>{worte.lieferungen.msn}</Th>
                <Th>{worte.lieferungen.status}</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {liste.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <Link
                      href={`/atr/lieferungen/${l.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {l.lieferschein_nr ?? l.quelle_dateiname}
                    </Link>
                    {l.hinweise.length > 0 && (
                      <span className="ms-2 text-xs text-[var(--warn)]">
                        {l.hinweise.length} Hinweis
                        {l.hinweise.length === 1 ? "" : "e"}
                      </span>
                    )}
                  </Td>
                  <Td>{l.datum ? DATUM.format(new Date(l.datum)) : "—"}</Td>
                  <Td>{l.programm ?? "—"}</Td>
                  <Td>{l.msn ?? "—"}</Td>
                  <Td>
                    {l.status === "entwurf" ? (
                      <Badge variant="outline">{worte.lieferungen.entwurf}</Badge>
                    ) : (
                      <Badge>{worte.lieferungen.freigegeben}</Badge>
                    )}
                  </Td>
                  <Td className="text-end">
                    {darfSchreiben && (
                      <ConfirmDeleteButton
                        itemLabel={l.lieferschein_nr ?? l.quelle_dateiname}
                        onConfirm={() => loeschen.mutateAsync(l).then(() => undefined)}
                      />
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
