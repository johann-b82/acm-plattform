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

/**
 * Die Maschinen und ihre Wartung.
 *
 * Es gibt keine Liste fälliger Termine — das Intervall ist eine Regel, und der
 * Nachweis ist ein Bogen, auf dem in der Spalte der Kalenderwoche abgezeichnet
 * wird. Alles andere wäre eine Terminliste, die niemand pflegt.
 */
export function Maschinenliste({ darfSchreiben }: { darfSchreiben: boolean }) {
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produktion</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Maschinen und ihre wiederkehrenden Wartungsaufgaben. Der Nachweis
            entsteht als Bogen zum Aushängen — je Halbjahr, mit einer Spalte
            pro Kalenderwoche.
          </p>
        </div>
        <Link href="/kpi/produktion" className="text-sm underline-offset-4 hover:underline">
          Zu den Kennzahlen
        </Link>
      </div>

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="neue-maschine">Neue Maschine</Label>
            <Input
              id="neue-maschine"
              value={neu}
              placeholder="z. B. Fräse 3"
              onChange={(e) => setNeu(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && neu.trim()) anlegen.mutate();
              }}
            />
          </div>
          <Button disabled={!neu.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Anlegen
          </Button>
        </Card>
      )}

      {maschinen.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title="Noch keine Maschine"
          body="Leg eine Maschine an und hinterlege ihre Wartungsaufgaben."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Maschine</Th>
                <Th>Inventar-Nr.</Th>
                <Th>Standort</Th>
                <Th>Verantwortlich</Th>
                <Th>Status</Th>
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
                      <Badge>aktiv</Badge>
                    ) : (
                      <Badge variant="outline">stillgelegt</Badge>
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
