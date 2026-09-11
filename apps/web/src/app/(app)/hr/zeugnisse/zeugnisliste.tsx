"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { ARTEN, zeugnisApi, zeugnisKeys } from "@/lib/zeugnisse";
import { onboardingApi, onboardingKeys } from "@/lib/onboarding";
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
 * Die Zeugnisse.
 *
 * Beim Anlegen werden die Stammdaten der Person abgeschrieben, nicht
 * verknüpft: ein im Mai ausgestelltes Zeugnis darf im September nicht anders
 * aussehen, weil sich in Personio eine Abteilung geändert hat.
 */
export function Zeugnisliste() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [person, setPerson] = useState("");
  const [art, setArt] = useState<string>("qualifiziert");

  const zeugnisse = useQuery({ queryKey: zeugnisKeys.liste(), queryFn: zeugnisApi.liste });
  const eintritte = useQuery({
    queryKey: onboardingKeys.eintritte(),
    queryFn: onboardingApi.eintritte,
  });

  const anlegen = useMutation({
    mutationFn: () => {
      const gewaehlt = (eintritte.data ?? []).find(
        (e) => String(e.employee_id ?? e.extern_id) === person,
      );
      if (!gewaehlt) throw new Error("Bitte eine Person wählen.");
      return zeugnisApi.anlegen({
        employee_id: gewaehlt.employee_id,
        extern_id: gewaehlt.extern_id,
        name: gewaehlt.name,
        abteilung: gewaehlt.abteilung,
        taetigkeit: gewaehlt.position,
        eintritt: gewaehlt.eintritt,
        art,
      });
    },
    onSuccess: (z) => {
      queryClient.invalidateQueries({ queryKey: ["zeugnisse"] });
      router.push(`/hr/zeugnisse/${z.id}`);
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const liste = zeugnisse.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Zeugnisse</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Aus Noten und Stichpunkten wird Zeugnissprache. Die Stammdaten
            werden beim Anlegen abgeschrieben — ein ausgestelltes Zeugnis ändert
            sich nicht mehr, weil sich Personio ändert.
          </p>
        </div>
        <Link href="/hr" className="text-sm underline-offset-4 hover:underline">
          Personal
        </Link>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="flex min-w-56 flex-col gap-1">
          <Label htmlFor="person">Person</Label>
          <Select id="person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">— wählen —</option>
            {(eintritte.data ?? []).map((e) => (
              <option
                key={e.employee_id ?? e.extern_id}
                value={String(e.employee_id ?? e.extern_id)}
              >
                {e.name}
                {e.abteilung ? ` · ${e.abteilung}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="art">Art</Label>
          <Select id="art" value={art} onChange={(e) => setArt(e.target.value)}>
            {ARTEN.map((a) => (
              <option key={a.wert} value={a.wert}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <Button disabled={!person || anlegen.isPending} onClick={() => anlegen.mutate()}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Anlegen
        </Button>
      </Card>

      {zeugnisse.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title="Noch kein Zeugnis"
          body="Wähl eine Person und die Zeugnisart — die Stammdaten kommen dann von selbst."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Art</Th>
                <Th>Zeitraum</Th>
                <Th>Note</Th>
                <Th>Stand</Th>
                <Th>Angelegt</Th>
              </tr>
            </thead>
            <tbody>
              {liste.map((z) => (
                <tr key={z.id}>
                  <Td>
                    <Link
                      href={`/hr/zeugnisse/${z.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {z.name}
                    </Link>
                  </Td>
                  <Td>{ARTEN.find((a) => a.wert === z.art)?.label ?? z.art}</Td>
                  <Td>
                    {z.eintritt ? DATUM.format(new Date(z.eintritt)) : "—"}
                    {z.austritt ? ` – ${DATUM.format(new Date(z.austritt))}` : ""}
                  </Td>
                  <Td className="tabular-nums">{z.schlussnote ?? "—"}</Td>
                  <Td>
                    {z.status === "fertig" ? (
                      <Badge>fertig</Badge>
                    ) : (
                      <Badge variant="outline">Entwurf</Badge>
                    )}
                  </Td>
                  <Td>{DATUM.format(new Date(z.erstellt_am))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
