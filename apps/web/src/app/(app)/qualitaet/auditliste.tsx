"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import {
  AUDIT_STATUS_LABEL,
  auditApi,
  auditKeys,
  fortschritt,
  type Audit,
  type Stand,
} from "@/lib/audit";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/** Ein Audit gilt als laufend, solange es nicht abgeschlossen oder abgesagt ist. */
const LAEUFT = new Set(["geplant", "in_vorbereitung", "in_durchfuehrung", "berichtet", "massnahmen_offen"]);

export function Auditliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [neu, setNeu] = useState({ nummer: "", titel: "", art: "intern", vorlage: "" });

  const audits = useQuery({ queryKey: auditKeys.liste(), queryFn: auditApi.liste });
  const stand = useQuery({ queryKey: auditKeys.stand(), queryFn: auditApi.stand });
  const vorlagen = useQuery({ queryKey: auditKeys.vorlagen(), queryFn: auditApi.vorlagen });

  const standNach = useMemo(() => {
    const m = new Map<string, Stand>();
    for (const s of stand.data ?? []) m.set(s.audit_id, s);
    return m;
  }, [stand.data]);

  const anlegen = useMutation({
    mutationFn: () =>
      auditApi.anlegen({
        nummer: neu.nummer.trim(),
        titel: neu.titel.trim(),
        art: neu.art as "intern" | "extern",
        vorlage_id: neu.vorlage || null,
      }),
    onSuccess: (a: Audit) => {
      toast.success("Audit angelegt.");
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      router.push(`/qualitaet/${a.id}`);
    },
    onError: (fehler: Error) =>
      toast.error(
        /duplicate|unique/i.test(fehler.message)
          ? "Diese Auditnummer gibt es schon."
          : fehler.message,
      ),
  });

  const liste = audits.data ?? [];
  const laufend = liste.filter((a) => LAEUFT.has(a.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Qualität</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Audits von der Planung bis zum Abschluss. Jede Statusänderung steht
            im Verlauf — geschrieben von der Datenbank, nicht von der Maske,
            und danach unveränderlich.
          </p>
        </div>
        <Link href="/kpi/qualitaet" className="text-sm underline-offset-4 hover:underline">
          Zu den Kennzahlen
        </Link>
      </div>

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="nummer">Nummer</Label>
            <Input
              id="nummer"
              className="w-36"
              value={neu.nummer}
              placeholder="A-2026-01"
              onChange={(e) => setNeu({ ...neu, nummer: e.target.value })}
            />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="titel">Titel</Label>
            <Input
              id="titel"
              value={neu.titel}
              placeholder="EN 9100 Systemaudit"
              onChange={(e) => setNeu({ ...neu, titel: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="art">Art</Label>
            <Select
              id="art"
              value={neu.art}
              onChange={(e) => setNeu({ ...neu, art: e.target.value })}
            >
              <option value="intern">intern</option>
              <option value="extern">extern</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vorlage">Phasenvorlage</Label>
            <Select
              id="vorlage"
              value={neu.vorlage}
              onChange={(e) => setNeu({ ...neu, vorlage: e.target.value })}
            >
              <option value="">ohne</option>
              {(vorlagen.data ?? [])
                .filter((v) => v.aktiv)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </Select>
          </div>
          <Button
            disabled={!neu.nummer.trim() || !neu.titel.trim() || anlegen.isPending}
            onClick={() => anlegen.mutate()}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Anlegen
          </Button>
        </Card>
      )}

      {audits.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title="Noch kein Audit"
          body="Leg eines an — mit einer Phasenvorlage bringt es seine Checkliste gleich mit."
        />
      ) : (
        <>
          <p className="text-sm text-[var(--fg-muted)]">
            {laufend.length} von {liste.length} laufen noch.
          </p>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Nummer</Th>
                  <Th>Titel</Th>
                  <Th>Art</Th>
                  <Th>Status</Th>
                  <Th>Fortschritt</Th>
                  <Th>Nächster Termin</Th>
                </tr>
              </thead>
              <tbody>
                {liste.map((a) => {
                  const s = standNach.get(a.id);
                  const prozent = fortschritt(s);
                  return (
                    <tr key={a.id}>
                      <Td>
                        <Link
                          href={`/qualitaet/${a.id}`}
                          className="font-medium tabular-nums underline-offset-4 hover:underline"
                        >
                          {a.nummer}
                        </Link>
                      </Td>
                      <Td>{a.titel}</Td>
                      <Td>{a.art}</Td>
                      <Td>
                        <Badge variant={a.status === "abgeschlossen" ? "secondary" : "outline"}>
                          {AUDIT_STATUS_LABEL[a.status]}
                        </Badge>
                      </Td>
                      <Td className="tabular-nums">
                        {prozent === null ? "—" : `${prozent} %`}
                        {s && s.ueberfaellig > 0 && (
                          <span className="ml-2 text-[var(--danger)]">
                            {s.ueberfaellig} überfällig
                          </span>
                        )}
                      </Td>
                      <Td>
                        {s?.naechster_termin
                          ? DATUM.format(new Date(s.naechster_termin))
                          : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        </>
      )}
    </div>
  );
}
