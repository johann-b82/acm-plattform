"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import {
  ERLAUBTE_TYPEN,
  fairApi,
  fairKeys,
  type Zeichnung,
} from "@/lib/fair";
import {
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
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";



/**
 * Die Zeichnungen einer Erstmusterprüfung. Hochladen, öffnen, löschen.
 */
export function Zeichnungsliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const DATUM = new Intl.DateTimeFormat(SPRACHE_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const zeichnungen = useQuery({
    queryKey: fairKeys.zeichnungen(),
    queryFn: fairApi.zeichnungen,
  });
  const liste = zeichnungen.data ?? [];

  const neuLaden = () =>
    queryClient.invalidateQueries({ queryKey: fairKeys.zeichnungen() });

  const hochladen = useMutation({
    mutationFn: (datei: File) => fairApi.hochladen(datei, name),
    onSuccess: () => {
      setName("");
      toast.success("Zeichnung hochgeladen.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (z: Zeichnung) => fairApi.zeichnungLoeschen(z),
    onSuccess: () => {
      toast.success("Zeichnung gelöscht.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <div className="space-y-6">
      <Seitenkopf untertitel={worte.fair.einleitung} />

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="name">{worte.fair.bezeichnungFrei}</Label>
            <Input
              id="name"
              value={name}
              placeholder={worte.fair.beispiel}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <label
            className={
              "inline-flex h-9 cursor-pointer items-center rounded-md bg-[var(--fg)] px-4 " +
              "text-sm font-medium text-[var(--bg)] hover:opacity-90 " +
              "focus-within:outline-2 focus-within:outline-[var(--ring)]"
            }
          >
            <FileUp className="mr-2 h-4 w-4" aria-hidden />
            {hochladen.isPending ? worte.fair.wirdGeladen : worte.fair.zeichnungWaehlen}
            <input
              type="file"
              accept={ERLAUBTE_TYPEN.join(",")}
              className="sr-only"
              aria-label={worte.fair.zeichnungWaehlen}
              disabled={hochladen.isPending}
              onChange={(e) => {
                const datei = e.target.files?.[0];
                e.target.value = "";
                if (datei) hochladen.mutate(datei);
              }}
            />
          </label>
        </Card>
      )}

      {zeichnungen.isLoading && (
        <p className="text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</p>
      )}

      {!zeichnungen.isLoading && liste.length === 0 && (
        <EmptyState
          title={worte.fair.keineZeichnung}
          body={
            darfSchreiben ? worte.fair.keineZeichnungSchreiben : worte.fair.keineZeichnungLesen
          }
        />
      )}

      {liste.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.fair.bezeichnung}</Th>
                <Th>{worte.fair.teilenummer}</Th>
                <Th>{worte.fair.kunde}</Th>
                <Th>{worte.fair.hochgeladen}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {liste.map((z) => (
                <tr key={z.id}>
                  <Td>
                    <Link
                      href={`/fair/${z.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {z.name}
                    </Link>
                  </Td>
                  <Td>{z.teilenummer ?? "—"}</Td>
                  <Td>{z.kunde ?? "—"}</Td>
                  <Td>{DATUM.format(new Date(z.erstellt_am))}</Td>
                  <Td className="text-right">
                    {darfSchreiben && (
                      <ConfirmDeleteButton
                        itemLabel={z.name}
                        onConfirm={() => loeschen.mutateAsync(z).then(() => undefined)}
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
