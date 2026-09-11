"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import {
  AUDIT_STATUS,
  KATEGORIEN,
  PHASEN_STATUS,
  auditApi,
  auditKeys,
  fortschritt,
  type Audit,
  type Kategorie,
  type Phase,
  type PhasenStatus,
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
  Textarea,
  Th,
} from "@/components/ui/primitives";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import { useAuditworte } from "@/lib/tafeln";
import type { Texte } from "@/texte";




const STAMM: { feld: keyof Audit; wort: keyof Texte["auditAnsicht"]; art?: "date" }[] = [
  { feld: "titel", wort: "titel" },
  { feld: "bereich", wort: "bereich" },
  { feld: "leitender_auditor", wort: "leitenderAuditor" },
  { feld: "team", wort: "auditteam" },
  { feld: "geplant_von", wort: "geplantVon", art: "date" },
  { feld: "geplant_bis", wort: "geplantBis", art: "date" },
];

export function AuditAnsicht({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const worte = useTexte();
  const auditworte = useAuditworte();
  const tag = SPRACHE_TAG[useSprache()];
  const ZEIT = new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" });
  const prioritaet: Record<number, string> = {
    1: worte.auditAnsicht.niedrig,
    2: worte.auditAnsicht.mittel,
    3: worte.auditAnsicht.hoch,
  };
  const aktion: Record<string, string> = {
    angelegt: worte.auditAnsicht.angelegt,
    geaendert: worte.auditAnsicht.geaendert,
    geloescht: worte.auditAnsicht.geloescht,
    status: worte.auditAnsicht.status,
    uebersprungen: worte.auditAnsicht.uebersprungen,
  };
  const queryClient = useQueryClient();
  const [neuePhase, setNeuePhase] = useState("");

  const audit = useQuery({ queryKey: auditKeys.eines(id), queryFn: () => auditApi.eines(id) });
  const phasen = useQuery({ queryKey: auditKeys.phasen(id), queryFn: () => auditApi.phasen(id) });
  const stand = useQuery({ queryKey: auditKeys.stand(), queryFn: auditApi.stand });
  const kategorien = useQuery({
    queryKey: auditKeys.kategorien(id),
    queryFn: () => auditApi.kategorien(id),
  });
  const normen = useQuery({ queryKey: auditKeys.normen(), queryFn: auditApi.normen });
  const normbezug = useQuery({
    queryKey: auditKeys.normbezug(id),
    queryFn: () => auditApi.normbezug(id),
  });
  const verlauf = useQuery({
    queryKey: auditKeys.verlauf(id),
    queryFn: () => auditApi.verlauf(id),
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["audit"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const aendern = useMutation({
    mutationFn: (felder: Partial<Audit>) => auditApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const phaseAendern = useMutation({
    mutationFn: ({ phase, felder }: { phase: Phase; felder: Partial<Phase> }) =>
      auditApi.phaseAendern(phase.id, felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) =>
      toast.error(
        /audit_phasen_grund/.test(fehler.message)
          ? "Eine Pflichtphase braucht eine Begründung, bevor sie entfällt."
          : /audit_phasen_erledigt/.test(fehler.message)
            ? "Erledigt braucht ein Datum."
            : fehler.message,
      ),
  });

  const phaseAnlegen = useMutation({
    mutationFn: () =>
      auditApi.phaseAnlegen(
        id,
        neuePhase.trim(),
        Math.max(0, ...(phasen.data ?? []).map((p) => p.position)) + 1,
      ),
    onSuccess: () => {
      setNeuePhase("");
      return neuLaden();
    },
    onError: melde,
  });

  const kategorie = useMutation({
    mutationFn: ({ k, an }: { k: Kategorie; an: boolean }) =>
      auditApi.kategorieSetzen(id, k, an),
    onSuccess: neuLaden,
    onError: melde,
  });

  const norm = useMutation({
    mutationFn: ({ norm_id, an }: { norm_id: string; an: boolean }) =>
      auditApi.normSetzen(id, norm_id, an),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const a = audit.data;
  const gesetzt = useMemo(
    () => new Set((kategorien.data ?? []).map((k) => k.kategorie)),
    [kategorien.data],
  );
  const bezogen = useMemo(
    () => new Set((normbezug.data ?? []).map((n) => n.norm_id)),
    [normbezug.data],
  );
  const meinStand = (stand.data ?? []).find((s) => s.audit_id === id);
  const prozent = fortschritt(meinStand);

  if (audit.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>;
  }
  if (!a) {
    return <EmptyState title={worte.auditAnsicht.gibtEsNicht} body={worte.auditAnsicht.gibtEsNichtText} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            <span className="tabular-nums">{a.nummer}</span> · {a.titel}
          </h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {a.art === "intern" ? worte.auditAnsicht.internesAudit : worte.auditAnsicht.externesAudit}
            {worte.auditAnsicht.prioritaet(prioritaet[a.prioritaet])}
            {prozent !== null && worte.auditAnsicht.erledigt(prozent)}
            {meinStand && meinStand.ueberfaellig > 0 && (
              <span className="text-[var(--danger)]">
                {worte.auditAnsicht.ueberfaellig(meinStand.ueberfaellig)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/qualitaet" className="text-sm underline-offset-4 hover:underline">
            {worte.auditAnsicht.zurUebersicht}
          </Link>
          <Select
            aria-label={worte.auditAnsicht.status}
            value={a.status}
            disabled={!darfSchreiben}
            onChange={(e) =>
              aendern.mutate({ status: e.target.value as Audit["status"] })
            }
          >
            {AUDIT_STATUS.map((s) => (
              <option key={s.wert} value={s.wert}>
                {auditworte[s.wert]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">{worte.auditAnsicht.stammdaten}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STAMM.map(({ feld, wort, art }) => (
            <div key={feld} className="flex flex-col gap-1">
              <Label htmlFor={feld}>{worte.auditAnsicht[wort] as string}</Label>
              <Input
                id={feld}
                type={art === "date" ? "date" : "text"}
                defaultValue={(a[feld] as string | null) ?? ""}
                placeholder="—"
                disabled={!darfSchreiben}
                onBlur={(e) => {
                  const wert = e.target.value.trim();
                  const alt = (a[feld] as string | null) ?? "";
                  if (wert === alt) return;
                  aendern.mutate({ [feld]: wert || null } as Partial<Audit>);
                }}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="prioritaet">{worte.auditAnsicht.prioritaetFeld}</Label>
            <Select
              id="prioritaet"
              value={String(a.prioritaet)}
              disabled={!darfSchreiben}
              onChange={(e) => aendern.mutate({ prioritaet: Number(e.target.value) })}
            >
              <option value="1">{worte.auditAnsicht.niedrig}</option>
              <option value="2">{worte.auditAnsicht.mittel}</option>
              <option value="3">{worte.auditAnsicht.hoch}</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ziel">{worte.auditAnsicht.auditziel}</Label>
          <Textarea
            id="ziel"
            rows={3}
            defaultValue={a.ziel}
            disabled={!darfSchreiben}
            onBlur={(e) => {
              if (e.target.value !== a.ziel) aendern.mutate({ ziel: e.target.value });
            }}
          />
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">{worte.auditAnsicht.kategorien}</h2>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          Ein Audit ist oft mehreres zugleich — das interne Programm fährt
          Prozess- und Produktaudit in derselben Sitzung. Deshalb eine Auswahl,
          keine einzelne Angabe.
        </p>
        <div className="flex flex-wrap gap-2">
          {KATEGORIEN.map((k) => {
            const an = gesetzt.has(k.wert);
            return (
              <Button
                key={k.wert}
                size="sm"
                variant={an ? "default" : "outline"}
                disabled={!darfSchreiben}
                onClick={() => kategorie.mutate({ k: k.wert, an: !an })}
              >
                {auditworte[k.wert]}
              </Button>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">{worte.auditAnsicht.normbezug}</h2>
        {(normen.data ?? []).filter((n) => n.aktiv).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.auditAnsicht.normmatrixLeer}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(normen.data ?? [])
              .filter((n) => n.aktiv)
              .map((n) => {
                const an = bezogen.has(n.id);
                return (
                  <Button
                    key={n.id}
                    size="sm"
                    variant={an ? "default" : "outline"}
                    disabled={!darfSchreiben}
                    title={n.kurztext || undefined}
                    onClick={() => norm.mutate({ norm_id: n.id, an: !an })}
                  >
                    {n.regelwerk} {n.klausel}
                    {!n.geprueft && " *"}
                  </Button>
                );
              })}
          </div>
        )}
        <p className="text-xs text-[var(--fg-muted)]">
          {worte.auditAnsicht.nichtGeprueft}
        </p>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">{worte.auditAnsicht.phasen}</h2>
        {(phasen.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.auditAnsicht.keinePhasen}
          </p>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>{worte.auditAnsicht.phase}</Th>
                  <Th>{worte.auditAnsicht.status}</Th>
                  <Th>{worte.auditAnsicht.verantwortlich}</Th>
                  <Th>{worte.auditAnsicht.faellig}</Th>
                  <Th>{worte.auditAnsicht.erledigtAm}</Th>
                </tr>
              </thead>
              <tbody>
                {(phasen.data ?? []).map((p) => (
                  <PhasenZeile
                    key={p.id}
                    phase={p}
                    darfSchreiben={darfSchreiben}
                    aendern={(felder) => phaseAendern.mutate({ phase: p, felder })}
                  />
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}

        {darfSchreiben && (
          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="neue-phase">{worte.auditAnsicht.phaseErgaenzen}</Label>
              <Input
                id="neue-phase"
                value={neuePhase}
                placeholder={worte.auditAnsicht.phaseBeispiel}
                onChange={(e) => setNeuePhase(e.target.value)}
              />
            </div>
            <Button
              disabled={!neuePhase.trim() || phaseAnlegen.isPending}
              onClick={() => phaseAnlegen.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Hinzufügen
            </Button>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">{worte.auditAnsicht.verlauf}</h2>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          {worte.auditAnsicht.verlaufHinweis}
        </p>
        {(verlauf.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">{worte.auditAnsicht.nichtsGeschehen}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {(verlauf.data ?? []).map((z) => (
              <li key={z.id} className="flex flex-wrap items-baseline gap-2 py-2">
                <span className="tabular-nums text-[var(--fg-muted)]">
                  {ZEIT.format(new Date(z.wann))}
                </span>
                <span className="font-medium">
                  {z.entitaet === "audits" ? "Audit" : worte.auditAnsicht.phase}{" "}
                  {aktion[z.aktion] ?? z.aktion}
                </span>
                {z.alt && z.neu && (
                  <span className="text-[var(--fg-muted)]">
                    {auditworte[z.alt] ?? z.alt} → {auditworte[z.neu] ?? z.neu}
                  </span>
                )}
                {z.grund && (
                  <span className="text-[var(--fg-muted)]">{`„${z.grund}“`}</span>
                )}
                <span className="ml-auto text-[var(--fg-muted)]">{z.wer_email ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Eine Phasenzeile.
 *
 * Der Statuswechsel trägt die zwei Bedingungen der Datenbank mit: „erledigt"
 * setzt das Datum gleich mit, und eine Pflichtphase, die entfallen soll,
 * fragt vorher nach dem Grund. Ohne das käme die Meldung erst aus Postgres —
 * richtig, aber unhöflich.
 */
function PhasenZeile({
  phase,
  darfSchreiben,
  aendern,
}: {
  phase: Phase;
  darfSchreiben: boolean;
  aendern: (felder: Partial<Phase>) => void;
}) {
  const worte = useTexte();
  const auditworte = useAuditworte();
  const DATUM = new Intl.DateTimeFormat(SPRACHE_TAG[useSprache()], { dateStyle: "medium" });
  const [grund, setGrund] = useState(false);
  const [text, setText] = useState("");

  function statusWechsel(status: PhasenStatus) {
    if (status === "erledigt") {
      aendern({ status, erledigt_am: new Date().toISOString().slice(0, 10) });
      return;
    }
    if (status === "nicht_zutreffend" && phase.pflicht) {
      setGrund(true);
      return;
    }
    aendern({ status, erledigt_am: null });
  }

  return (
    <>
      <tr>
        <Td className="tabular-nums">{phase.position}</Td>
        <Td>
          {phase.titel}
          {phase.pflicht && (
            <Badge variant="outline" className="ml-2">
              Pflicht
            </Badge>
          )}
        </Td>
        <Td>
          <Select
            // In einer Tabellenzelle schrumpft ein `select` sonst auf den
            // Pfeil zusammen und zeigt seinen Wert gar nicht mehr.
            className="min-w-40"
            aria-label={`Status von ${phase.titel}`}
            value={phase.status}
            disabled={!darfSchreiben}
            onChange={(e) => statusWechsel(e.target.value as PhasenStatus)}
          >
            {PHASEN_STATUS.map((s) => (
              <option key={s.wert} value={s.wert}>
                {auditworte[s.wert]}
              </option>
            ))}
          </Select>
        </Td>
        <Td>
          <Input
            defaultValue={phase.verantwortlich ?? ""}
            placeholder="—"
            disabled={!darfSchreiben}
            onBlur={(e) => {
              const wert = e.target.value.trim() || null;
              if (wert !== phase.verantwortlich) aendern({ verantwortlich: wert });
            }}
          />
        </Td>
        <Td>
          <Input
            type="date"
            defaultValue={phase.faellig_am ?? ""}
            disabled={!darfSchreiben}
            onBlur={(e) => {
              const wert = e.target.value || null;
              if (wert !== phase.faellig_am) aendern({ faellig_am: wert });
            }}
          />
        </Td>
        <Td>{phase.erledigt_am ? DATUM.format(new Date(phase.erledigt_am)) : "—"}</Td>
      </tr>
      {grund && (
        <tr>
          <Td />
          <Td colSpan={5}>
            <div className="flex flex-wrap items-end gap-2 py-2">
              <div className="flex min-w-64 flex-1 flex-col gap-1">
                <Label htmlFor={`grund-${phase.id}`}>{worte.auditAnsicht.warumEntfaellt}</Label>
                <Input
                  id={`grund-${phase.id}`}
                  value={text}
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <Button
                disabled={!text.trim()}
                onClick={() => {
                  aendern({
                    status: "nicht_zutreffend",
                    uebersprungen_warum: text.trim(),
                    erledigt_am: null,
                  });
                  setGrund(false);
                  setText("");
                }}
              >
                {worte.auditAnsicht.uebernehmen}
              </Button>
              <Button variant="outline" onClick={() => setGrund(false)}>
                {worte.auditAnsicht.abbrechen}
              </Button>
            </div>
          </Td>
        </tr>
      )}
    </>
  );
}
