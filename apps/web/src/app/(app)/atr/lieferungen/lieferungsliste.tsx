"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import {
  lieferungApi,
  lieferungKeys,
  type Lieferung,
  type LieferscheinErgebnis,
} from "@/lib/atr";
import {
  Badge,
  Card,
  EmptyState,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * Die eingelesenen Lieferscheine. Ein Entwurf wartet auf Durchsicht, eine
 * freigegebene Lieferung ist fertig — und ihre Positionen lassen sich dann
 * nicht mehr ändern (das hält die Datenbank, nicht diese Seite).
 */
export function Lieferungsliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const [bericht, setBericht] = useState<LieferscheinErgebnis | null>(null);

  const lieferungen = useQuery({
    queryKey: lieferungKeys.liste(),
    queryFn: lieferungApi.liste,
  });
  const liste = lieferungen.data ?? [];

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ATR-Lieferungen</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Ein Lieferschein wird eingelesen, gegen den Teilekatalog
            abgeglichen und als Entwurf abgelegt. Nach der Durchsicht wird er
            freigegeben.
          </p>
        </div>
        <Link href="/atr" className="text-sm underline-offset-4 hover:underline">
          Zum Teilekatalog
        </Link>
      </div>

      {darfSchreiben && (
        <Card className="space-y-3 p-4">
          <label
            className={
              "inline-flex h-9 cursor-pointer items-center rounded-md bg-[var(--fg)] " +
              "px-4 text-sm font-medium text-[var(--bg)] hover:opacity-90 " +
              "focus-within:outline-2 focus-within:outline-[var(--ring)]"
            }
          >
            <FileUp className="mr-2 h-4 w-4" aria-hidden />
            {einlesen.isPending ? "Wird gelesen …" : "Lieferschein einlesen"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              aria-label="Lieferschein einlesen"
              disabled={einlesen.isPending}
              onChange={(e) => {
                const datei = e.target.files?.[0];
                e.target.value = "";
                if (datei) einlesen.mutate(datei);
              }}
            />
          </label>

          {bericht && (
            <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
              <p>
                <span className="font-medium">{bericht.dateiname}</span>
                {bericht.lieferschein_nr && ` · Nr. ${bericht.lieferschein_nr}`}:{" "}
                {bericht.positionen} Positionen, {bericht.zugeordnet} im Katalog
                gefunden.
              </p>
              <p className="mt-1 text-[var(--fg-muted)]">{bericht.programm_grund}</p>
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

      {lieferungen.isLoading && (
        <p className="text-sm text-[var(--fg-muted)]">Wird geladen …</p>
      )}

      {!lieferungen.isLoading && liste.length === 0 && (
        <EmptyState
          title="Noch kein Lieferschein"
          body={
            darfSchreiben
              ? "Ein Lieferschein-PDF einlesen — danach steht er hier zur Durchsicht."
              : "Sobald ein Lieferschein eingelesen ist, steht er hier."
          }
        />
      )}

      {liste.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Lieferschein</Th>
                <Th>Datum</Th>
                <Th>Programm</Th>
                <Th>MSN</Th>
                <Th>Status</Th>
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
                      <span className="ml-2 text-xs text-[var(--warn)]">
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
                      <Badge variant="outline">Entwurf</Badge>
                    ) : (
                      <Badge>freigegeben</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
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
