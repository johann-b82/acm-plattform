"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ClipboardCopy, Download } from "lucide-react";

import { fairApi, fairKeys, type Ballon } from "@/lib/fair";
import { alsCsv, alsTsv } from "@/lib/fair/geometrie";
import {
  Button,
  Card,
  Input,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Die Prüfliste: Nummer, Seite, gemessener Wert.
 *
 * Die Nummer lässt sich nicht tippen — sie gehört der Datenbank. Verschieben
 * ändert die Reihenfolge, und die Datenbank schreibt die Nummern in einem Zug
 * um; ein Löschen schließt die Lücke von selbst.
 */
export function Ballonliste({
  zeichnungId,
  ballons,
  gewaehlt,
  darfSchreiben,
  onWaehlen,
}: {
  zeichnungId: string;
  ballons: Ballon[];
  gewaehlt: string | null;
  darfSchreiben: boolean;
  onWaehlen: (b: Ballon) => void;
}) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const neuLaden = () =>
    queryClient.invalidateQueries({ queryKey: fairKeys.ballons(zeichnungId) });

  const aendern = useMutation({
    mutationFn: ({ id, wert }: { id: string; wert: string }) =>
      fairApi.ballonAendern(id, { wert }),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => fairApi.ballonLoeschen(id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const umsortieren = useMutation({
    mutationFn: (ids: string[]) => fairApi.reihenfolge(zeichnungId, ids),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  /** Tauscht mit dem Nachbarn und schickt die ganze Folge — die Funktion in
   *  der Datenbank verlangt sie vollständig, damit keine halbe Reihenfolge
   *  entstehen kann. */
  const verschieben = (index: number, richtung: -1 | 1) => {
    const ids = ballons.map((b) => b.id);
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= ids.length) return;
    [ids[index], ids[ziel]] = [ids[ziel], ids[index]];
    umsortieren.mutate(ids);
  };

  const inZwischenablage = async () => {
    try {
      await navigator.clipboard.writeText(alsTsv(ballons));
      toast.success("Prüfliste kopiert — in Excel einfügbar.");
    } catch {
      toast.error("Die Zwischenablage ließ sich nicht beschreiben.");
    }
  };

  const alsDatei = () => {
    // Mit BOM, sonst zeigt deutsches Excel Umlaute falsch an.
    const blob = new Blob(["﻿" + alsCsv(ballons)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pruefliste.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">{worte.fair.pruefliste}</h2>
        <span className="text-sm text-[var(--fg-muted)]">
          {ballons.length === 1 ? worte.fair.einMass : worte.fair.masse(ballons.length)}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={inZwischenablage}
            disabled={ballons.length === 0}
          >
            <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {worte.fair.kopieren}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={alsDatei}
            disabled={ballons.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {worte.fair.csv}
          </Button>
        </div>
      </div>

      {ballons.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--fg-muted)]">
          {worte.fair.keinMass}
        </p>
      ) : (
        <TableWrap className="mt-3">
          <Table>
            <thead>
              <tr>
                <Th className="w-16">{worte.fair.nr}</Th>
                <Th className="w-20">{worte.fair.seite}</Th>
                <Th>{worte.fair.wert}</Th>
                <Th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {ballons.map((b, i) => (
                <tr
                  key={b.id}
                  onClick={() => onWaehlen(b)}
                  className={gewaehlt === b.id ? "bg-[var(--muted)]" : undefined}
                >
                  <Td className="tabular-nums">{b.nummer}</Td>
                  <Td className="tabular-nums">{b.seite}</Td>
                  <Td>
                    <Input
                      defaultValue={b.wert}
                      aria-label={worte.fair.wertZu(b.nummer)}
                      placeholder={worte.fair.wertBeispiel}
                      disabled={!darfSchreiben}
                      onBlur={(e) => {
                        if (e.target.value !== b.wert) {
                          aendern.mutate({ id: b.id, wert: e.target.value });
                        }
                      }}
                    />
                  </Td>
                  <Td className="text-right">
                    {darfSchreiben && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={worte.fair.nachOben(b.nummer)}
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            verschieben(i, -1);
                          }}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={worte.fair.nachUnten(b.nummer)}
                          disabled={i === ballons.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            verschieben(i, 1);
                          }}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <ConfirmDeleteButton
                          itemLabel={worte.fair.nummer(b.nummer)}
                          onConfirm={() =>
                            loeschen.mutateAsync(b.id).then(() => undefined)
                          }
                        />
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
