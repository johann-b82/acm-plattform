"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { wartungApi, wartungKeys, type Maschine } from "@/lib/wartung";
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
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";

/**
 * Die Maschinen und ihre Wartung.
 *
 * Es gibt keine Liste fälliger Termine — das Intervall ist eine Regel, und der
 * Nachweis ist ein Bogen, auf dem in der Spalte der Kalenderwoche abgezeichnet
 * wird. Alles andere wäre eine Terminliste, die niemand pflegt.
 */
export function Maschinenliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState("");

  const maschinen = useQuery({
    queryKey: wartungKeys.maschinen(),
    queryFn: wartungApi.maschinen,
  });
  const liste = maschinen.data ?? [];

  const anlegen = useMutation({
    mutationFn: () => wartungApi.anlegen(neu.trim()),
    onSuccess: () => {
      setNeu("");
      toast.success("Maschine angelegt.");
      return queryClient.invalidateQueries({ queryKey: ["wartung"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.wartung.einleitung}
        unter={
          <div className="mt-2 flex justify-start text-sm">
            <Link href="/kpi/produktion" className="underline-offset-4 hover:underline">
              {worte.wartung.zuKennzahlen}
            </Link>
          </div>
        }
      />

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="neue-maschine">{worte.wartung.neueMaschine}</Label>
            <Input
              id="neue-maschine"
              value={neu}
              placeholder={worte.wartung.beispiel}
              onChange={(e) => setNeu(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && neu.trim()) anlegen.mutate();
              }}
            />
          </div>
          <Button disabled={!neu.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {worte.wartung.anlegen}
          </Button>
        </Card>
      )}

      {maschinen.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title={worte.wartung.keineMaschine}
          body={worte.wartung.keineMaschineText}
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.wartung.maschine}</Th>
                <Th>{worte.wartung.inventarnummer}</Th>
                <Th>{worte.wartung.standort}</Th>
                <Th>{worte.wartung.verantwortlich}</Th>
                <Th>{worte.wartung.status}</Th>
              </tr>
            </thead>
            <tbody>
              {liste.map((m: Maschine) => (
                <tr key={m.id}>
                  <Td>
                    <Link
                      href={`/produktion/${m.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {m.name}
                    </Link>
                  </Td>
                  <Td>{m.inventarnummer ?? "—"}</Td>
                  <Td>{m.standort ?? "—"}</Td>
                  <Td>{m.verantwortlich ?? "—"}</Td>
                  <Td>
                    {m.status === "aktiv" ? (
                      <Badge>{worte.wartung.aktiv}</Badge>
                    ) : (
                      <Badge variant="outline">{worte.wartung.stillgelegt}</Badge>
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
