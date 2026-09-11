"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import {
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
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { useAuditworte } from "@/lib/tafeln";



/** Ein Audit gilt als laufend, solange es nicht abgeschlossen oder abgesagt ist. */
const LAEUFT = new Set(["geplant", "in_vorbereitung", "in_durchfuehrung", "berichtet", "massnahmen_offen"]);

export function Auditliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const auditworte = useAuditworte();
  const DATUM = new Intl.DateTimeFormat(SPRACHE_TAG[useSprache()], { dateStyle: "medium" });
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
      <Seitenkopf
        titel={worte.pfad.seiten["/qualitaet"]}
        untertitel={worte.audit.einleitung}
        unter={
          <div className="mt-2 flex justify-center text-sm">
            <Link href="/kpi/qualitaet" className="underline-offset-4 hover:underline">
              {worte.audit.zuKennzahlen}
            </Link>
          </div>
        }
      />

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="nummer">{worte.audit.nummer}</Label>
            <Input
              id="nummer"
              className="w-36"
              value={neu.nummer}
              placeholder={worte.audit.nummerBeispiel}
              onChange={(e) => setNeu({ ...neu, nummer: e.target.value })}
            />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="titel">{worte.audit.titel}</Label>
            <Input
              id="titel"
              value={neu.titel}
              placeholder={worte.audit.titelBeispiel}
              onChange={(e) => setNeu({ ...neu, titel: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="art">{worte.audit.art}</Label>
            <Select
              id="art"
              value={neu.art}
              onChange={(e) => setNeu({ ...neu, art: e.target.value })}
            >
              <option value="intern">{worte.audit.intern}</option>
              <option value="extern">{worte.audit.extern}</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vorlage">{worte.audit.phasenvorlage}</Label>
            <Select
              id="vorlage"
              value={neu.vorlage}
              onChange={(e) => setNeu({ ...neu, vorlage: e.target.value })}
            >
              <option value="">{worte.audit.ohne}</option>
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
            {worte.audit.anlegen}
          </Button>
        </Card>
      )}

      {audits.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title={worte.audit.keinAudit}
          body={worte.audit.keinAuditText}
        />
      ) : (
        <>
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.audit.laufen(laufend.length, liste.length)}
          </p>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{worte.audit.nummer}</Th>
                  <Th>{worte.audit.titel}</Th>
                  <Th>{worte.audit.art}</Th>
                  <Th>{worte.audit.status}</Th>
                  <Th>{worte.audit.fortschritt}</Th>
                  <Th>{worte.audit.naechsterTermin}</Th>
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
                      <Td>{auditworte[a.art] ?? a.art}</Td>
                      <Td>
                        <Badge variant={a.status === "abgeschlossen" ? "secondary" : "outline"}>
                          {auditworte[a.status]}
                        </Badge>
                      </Td>
                      <Td className="tabular-nums">
                        {prozent === null ? "—" : `${prozent} %`}
                        {s && s.ueberfaellig > 0 && (
                          <span className="ml-2 text-[var(--danger)]">
                            {worte.audit.ueberfaellig(s.ueberfaellig)}
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
