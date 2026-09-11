"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { auditApi, auditKeys, type Norm, type Schritt } from "@/lib/audit";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Switch,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";
import { useAuditworte } from "@/lib/tafeln";

const LEERE_NORM = { regelwerk: "", revision: "", klausel: "", kurztext: "" };

/**
 * Normmatrix und Phasenvorlagen — die Stammdaten des Audit-Moduls.
 *
 * Eine Norm wird stillgelegt, nicht gelöscht: ein Audit, das sich auf sie
 * beruft, verlöre sonst still seine Grundlage. Die Datenbank hält das mit
 * `on delete restrict`; hier gibt es deshalb gar keinen Löschknopf.
 */
export function Qualitaet() {
  const worte = useTexte();
  const auditworte = useAuditworte();
  const queryClient = useQueryClient();
  const [neueNorm, setNeueNorm] = useState({ ...LEERE_NORM });
  const [neueVorlage, setNeueVorlage] = useState("");
  const [neuerSchritt, setNeuerSchritt] = useState<Record<string, string>>({});

  const normen = useQuery({ queryKey: auditKeys.normen(), queryFn: auditApi.normen });
  const vorlagen = useQuery({ queryKey: auditKeys.vorlagen(), queryFn: auditApi.vorlagen });
  const schritte = useQuery({ queryKey: auditKeys.schritte(), queryFn: auditApi.schritte });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["audit"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const normAnlegen = useMutation({
    mutationFn: () =>
      auditApi.normAnlegen({
        regelwerk: neueNorm.regelwerk.trim(),
        revision: neueNorm.revision.trim(),
        klausel: neueNorm.klausel.trim(),
        kurztext: neueNorm.kurztext.trim(),
      }),
    onSuccess: () => {
      setNeueNorm({ ...LEERE_NORM });
      return neuLaden();
    },
    onError: (fehler: Error) =>
      toast.error(
        /duplicate|unique/i.test(fehler.message)
          ? worte.qualitaetEinstellungen.schonInMatrix
          : fehler.message,
      ),
  });

  const normAendern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Partial<Norm> }) =>
      auditApi.normAendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const vorlageAnlegen = useMutation({
    mutationFn: () => auditApi.vorlageAnlegen(neueVorlage.trim()),
    onSuccess: () => {
      setNeueVorlage("");
      return neuLaden();
    },
    onError: melde,
  });

  const schrittAnlegen = useMutation({
    mutationFn: ({ vorlage_id, position }: { vorlage_id: string; position: number }) =>
      auditApi.schrittAnlegen(vorlage_id, position, (neuerSchritt[vorlage_id] ?? "").trim()),
    onSuccess: (_d, { vorlage_id }) => {
      setNeuerSchritt((s) => ({ ...s, [vorlage_id]: "" }));
      return neuLaden();
    },
    onError: melde,
  });

  const schrittWeg = useMutation({
    mutationFn: (id: string) => auditApi.schrittLoeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  // Die Rohdaten als Abhängigkeit, der Fallback erst innen — `?? []` würde
  // bei jedem Rendern ein neues Array erzeugen.
  const schritteDaten = schritte.data;
  const schritteNach = useMemo(() => {
    const m = new Map<string, Schritt[]>();
    for (const s of schritteDaten ?? []) {
      m.set(s.vorlage_id, [...(m.get(s.vorlage_id) ?? []), s]);
    }
    return m;
  }, [schritteDaten]);

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h3 className="font-medium">{worte.qualitaetEinstellungen.normmatrix}</h3>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          {worte.qualitaetEinstellungen.normmatrixHinweis}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="regelwerk">{worte.qualitaetEinstellungen.regelwerk}</Label>
            <Input
              id="regelwerk"
              className="w-40"
              value={neueNorm.regelwerk}
              placeholder="EN 9100"
              onChange={(e) => setNeueNorm({ ...neueNorm, regelwerk: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="revision">{worte.qualitaetEinstellungen.revision}</Label>
            <Input
              id="revision"
              className="w-28"
              value={neueNorm.revision}
              placeholder="2018"
              onChange={(e) => setNeueNorm({ ...neueNorm, revision: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="klausel">{worte.qualitaetEinstellungen.klausel}</Label>
            <Input
              id="klausel"
              className="w-28"
              value={neueNorm.klausel}
              placeholder="9.2"
              onChange={(e) => setNeueNorm({ ...neueNorm, klausel: e.target.value })}
            />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="kurztext">{worte.qualitaetEinstellungen.kurztext}</Label>
            <Input
              id="kurztext"
              value={neueNorm.kurztext}
              placeholder={worte.qualitaetEinstellungen.kurztextBeispiel}
              onChange={(e) => setNeueNorm({ ...neueNorm, kurztext: e.target.value })}
            />
          </div>
          <Button
            disabled={
              !neueNorm.regelwerk.trim() || !neueNorm.klausel.trim() || normAnlegen.isPending
            }
            onClick={() => normAnlegen.mutate()}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {worte.qualitaetEinstellungen.aufnehmen}
          </Button>
        </div>

        {(normen.data ?? []).length > 0 && (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{worte.qualitaetEinstellungen.regelwerk}</Th>
                  <Th>{worte.qualitaetEinstellungen.revision}</Th>
                  <Th>{worte.qualitaetEinstellungen.klausel}</Th>
                  <Th>{worte.qualitaetEinstellungen.kurztext}</Th>
                  <Th>{worte.qualitaetEinstellungen.geprueft}</Th>
                  <Th>{worte.qualitaetEinstellungen.aktiv}</Th>
                </tr>
              </thead>
              <tbody>
                {(normen.data ?? []).map((n) => (
                  <tr key={n.id}>
                    <Td>{n.regelwerk}</Td>
                    <Td>{n.revision || "—"}</Td>
                    <Td className="tabular-nums">{n.klausel}</Td>
                    <Td>{n.kurztext || "—"}</Td>
                    <Td>
                      <Switch
                        checked={n.geprueft}
                        label={worte.qualitaetEinstellungen.geprueftSchalter(`${n.regelwerk} ${n.klausel}`)}
                        onCheckedChange={(geprueft) =>
                          normAendern.mutate({ id: n.id, felder: { geprueft } })
                        }
                      />
                    </Td>
                    <Td>
                      <Switch
                        checked={n.aktiv}
                        label={worte.qualitaetEinstellungen.aktivSchalter(`${n.regelwerk} ${n.klausel}`)}
                        onCheckedChange={(aktiv) =>
                          normAendern.mutate({ id: n.id, felder: { aktiv } })
                        }
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-medium">{worte.qualitaetEinstellungen.phasenvorlagen}</h3>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          {worte.qualitaetEinstellungen.phasenvorlagenHinweis}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="neue-vorlage">{worte.qualitaetEinstellungen.neueVorlage}</Label>
            <Input
              id="neue-vorlage"
              value={neueVorlage}
              placeholder={worte.qualitaetEinstellungen.vorlageBeispiel}
              onChange={(e) => setNeueVorlage(e.target.value)}
            />
          </div>
          <Button
            disabled={!neueVorlage.trim() || vorlageAnlegen.isPending}
            onClick={() => vorlageAnlegen.mutate()}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {worte.qualitaetEinstellungen.anlegen}
          </Button>
        </div>

        {(vorlagen.data ?? []).map((v) => {
          const meine = schritteNach.get(v.id) ?? [];
          return (
            <div key={v.id} className="rounded-md border border-[var(--border)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-medium">{v.name}</h4>
                {v.kategorie && (
                  <Badge variant="outline">
                    {auditworte[v.kategorie]}
                  </Badge>
                )}
                <span className="text-sm text-[var(--fg-muted)]">
                  {worte.qualitaetEinstellungen.schritte(meine.length)}
                </span>
              </div>
              <ol className="mt-3 space-y-1 text-sm">
                {meine.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="w-6 tabular-nums text-[var(--fg-muted)]">
                      {s.position}
                    </span>
                    <span>{s.titel}</span>
                    {s.pflicht && (
                      <Badge variant="outline" className="ml-1">
                        Pflicht
                      </Badge>
                    )}
                    <span className="ml-auto">
                      <ConfirmDeleteButton
                        itemLabel={s.titel}
                        onConfirm={() => schrittWeg.mutateAsync(s.id).then(() => undefined)}
                      />
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="flex min-w-48 flex-1 flex-col gap-1">
                  <Label htmlFor={`schritt-${v.id}`}>{worte.qualitaetEinstellungen.schrittErgaenzen}</Label>
                  <Input
                    id={`schritt-${v.id}`}
                    value={neuerSchritt[v.id] ?? ""}
                    placeholder={worte.qualitaetEinstellungen.schrittBeispiel}
                    onChange={(e) =>
                      setNeuerSchritt((s) => ({ ...s, [v.id]: e.target.value }))
                    }
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={!(neuerSchritt[v.id] ?? "").trim()}
                  onClick={() =>
                    schrittAnlegen.mutate({
                      vorlage_id: v.id,
                      position: Math.max(0, ...meine.map((s) => s.position)) + 1,
                    })
                  }
                >
                  Hinzufügen
                </Button>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
