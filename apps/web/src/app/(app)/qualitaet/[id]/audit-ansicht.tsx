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
  phasenFehler,
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
  Textarea,
} from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { useAuditworte } from "@/lib/tafeln";
import type { Texte } from "@/texte";

type StammFeld = "titel" | "bereich" | "leitender_auditor" | "team" | "geplant_von" | "geplant_bis";

const STAMM: { feld: StammFeld; wort: keyof Texte["auditAnsicht"]; art?: "date" }[] = [
  { feld: "titel", wort: "titel" },
  { feld: "bereich", wort: "bereich" },
  { feld: "leitender_auditor", wort: "leitenderAuditor" },
  { feld: "team", wort: "auditteam" },
  { feld: "geplant_von", wort: "geplantVon", art: "date" },
  { feld: "geplant_bis", wort: "geplantBis", art: "date" },
];

type Stammentwurf = Record<StammFeld, string> & { prioritaet: string; ziel: string };

function entwurfAus(a: Audit): Stammentwurf {
  return {
    titel: a.titel,
    bereich: a.bereich,
    leitender_auditor: a.leitender_auditor ?? "",
    team: a.team,
    geplant_von: a.geplant_von ?? "",
    geplant_bis: a.geplant_bis ?? "",
    prioritaet: String(a.prioritaet),
    ziel: a.ziel,
  };
}

/** Heute als `JJJJ-MM-TT` in Ortszeit — `toISOString` läge nachts einen Tag daneben. */
function heute(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AuditAnsicht({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const worte = useTexte();
  const auditworte = useAuditworte();
  const tag = ZAHL_TAG[useSprache()];
  const ZEIT = new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" });
  const DATUM = new Intl.DateTimeFormat(tag, { dateStyle: "medium" });
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
  // EDIT-01: die Stammdaten stehen erst lesend da; „Bearbeiten" öffnet einen
  // Entwurf, der erst mit „Speichern" in die Zeile geht.
  const [stamm, setStamm] = useState<Stammentwurf | null>(null);
  // Welche Phase gerade bearbeitet wird — höchstens eine.
  const [offen, setOffen] = useState<string | null>(null);

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

  const stammSpeichern = useMutation({
    mutationFn: (e: Stammentwurf) =>
      auditApi.aendern(id, {
        titel: e.titel.trim(),
        bereich: e.bereich.trim(),
        leitender_auditor: e.leitender_auditor.trim() || null,
        team: e.team.trim(),
        geplant_von: e.geplant_von || null,
        geplant_bis: e.geplant_bis || null,
        prioritaet: Number(e.prioritaet),
        ziel: e.ziel,
      }),
    onSuccess: () => {
      setStamm(null);
      toast.success(worte.auditAnsicht.gespeichert);
      return neuLaden();
    },
    onError: (fehler: Error) =>
      toast.error(/audits_zeitraum/.test(fehler.message) ? worte.audit.zeitraumFehler : fehler.message),
  });

  const phaseSpeichern = useMutation({
    mutationFn: ({ phase, felder }: { phase: Phase; felder: Partial<Phase> }) =>
      auditApi.phaseAendern(phase.id, felder),
    onSuccess: () => {
      setOffen(null);
      toast.success(worte.auditAnsicht.phaseGespeichert);
      return neuLaden();
    },
    onError: (fehler: Error) =>
      toast.error(
        /audit_phasen_grund/.test(fehler.message)
          ? worte.auditAnsicht.grundPflicht
          : /audit_phasen_erledigt/.test(fehler.message)
            ? worte.auditAnsicht.datumPflicht
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
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</Card>;
  }
  if (!a) {
    return <EmptyState title={worte.auditAnsicht.gibtEsNicht} body={worte.auditAnsicht.gibtEsNichtText} />;
  }

  const stammFehler = stamm
    ? !stamm.titel.trim() ||
      (stamm.geplant_von !== "" && stamm.geplant_bis !== "" && stamm.geplant_bis < stamm.geplant_von)
    : false;

  const anzeige = (feld: StammFeld): string => {
    const wert = a[feld];
    if (!wert) return "—";
    return feld === "geplant_von" || feld === "geplant_bis" ? DATUM.format(new Date(wert)) : wert;
  };

  const phasenSpalten: Tabellenspalte<Phase>[] = [
    { schluessel: "position", titel: "#", typ: "zahl", wert: (p) => p.position },
    {
      schluessel: "titel",
      titel: worte.auditAnsicht.phase,
      typ: "text",
      wert: (p) => p.titel,
      zelle: (p) => (
        <>
          {p.titel}
          {p.pflicht && (
            <Badge variant="outline" className="ms-2">
              {worte.auditAnsicht.pflicht}
            </Badge>
          )}
        </>
      ),
    },
    {
      schluessel: "status",
      titel: worte.auditAnsicht.status,
      typ: "text",
      wert: (p) => auditworte[p.status],
      zelle: (p) => (
        <Badge variant={p.status === "erledigt" ? "secondary" : "outline"}>{auditworte[p.status]}</Badge>
      ),
    },
    {
      schluessel: "verantwortlich",
      titel: worte.auditAnsicht.verantwortlich,
      typ: "text",
      wert: (p) => p.verantwortlich,
    },
    {
      schluessel: "faellig_am",
      titel: worte.auditAnsicht.faellig,
      typ: "datum",
      wert: (p) => p.faellig_am,
      zelle: (p) => (p.faellig_am ? DATUM.format(new Date(p.faellig_am)) : "—"),
    },
    {
      schluessel: "erledigt_am",
      titel: worte.auditAnsicht.erledigtAm,
      typ: "datum",
      wert: (p) => p.erledigt_am,
      zelle: (p) => (p.erledigt_am ? DATUM.format(new Date(p.erledigt_am)) : "—"),
    },
    ...(darfSchreiben
      ? [
          {
            schluessel: "bearbeiten",
            titel: "",
            typ: "text" as const,
            wert: () => null,
            suchtext: false as const,
            sortierbar: false,
            ausrichtung: "end" as const,
            zelle: (p: Phase) => (
              <Button
                size="sm"
                variant="outline"
                aria-expanded={offen === p.id}
                onClick={() => setOffen(offen === p.id ? null : p.id)}
              >
                {offen === p.id ? worte.auditAnsicht.abbrechen : worte.auditAnsicht.bearbeiten}
              </Button>
            ),
          },
        ]
      : []),
  ];

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">{worte.auditAnsicht.stammdaten}</h2>
          {darfSchreiben && !stamm && (
            <Button size="sm" variant="outline" onClick={() => setStamm(entwurfAus(a))}>
              {worte.auditAnsicht.bearbeiten}
            </Button>
          )}
        </div>

        {stamm ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STAMM.map(({ feld, wort, art }) => (
                <div key={feld} className="flex flex-col gap-1">
                  <Label htmlFor={feld}>{worte.auditAnsicht[wort] as string}</Label>
                  <Input
                    id={feld}
                    type={art === "date" ? "date" : "text"}
                    value={stamm[feld]}
                    required={feld === "titel"}
                    maxLength={art === "date" ? undefined : 255}
                    onChange={(e) => setStamm({ ...stamm, [feld]: e.target.value })}
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <Label htmlFor="prioritaet">{worte.auditAnsicht.prioritaetFeld}</Label>
                <Select
                  id="prioritaet"
                  value={stamm.prioritaet}
                  onChange={(e) => setStamm({ ...stamm, prioritaet: e.target.value })}
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
                value={stamm.ziel}
                onChange={(e) => setStamm({ ...stamm, ziel: e.target.value })}
              />
            </div>
            {stamm.geplant_von !== "" && stamm.geplant_bis !== "" && stamm.geplant_bis < stamm.geplant_von && (
              <p className="text-xs text-[var(--danger)]">{worte.audit.zeitraumFehler}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={stammFehler || stammSpeichern.isPending}
                onClick={() => stammSpeichern.mutate(stamm)}
              >
                {worte.allgemein.speichern}
              </Button>
              <Button variant="outline" onClick={() => setStamm(null)}>
                {worte.allgemein.abbrechen}
              </Button>
            </div>
          </>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAMM.map(({ feld, wort }) => (
              <div key={feld} className="min-w-0">
                <dt className="text-xs text-[var(--fg-muted)]">{worte.auditAnsicht[wort] as string}</dt>
                <dd className="text-sm break-words">{anzeige(feld)}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-[var(--fg-muted)]">{worte.auditAnsicht.prioritaetFeld}</dt>
              <dd className="text-sm">{prioritaet[a.prioritaet]}</dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-[var(--fg-muted)]">{worte.auditAnsicht.auditziel}</dt>
              <dd className="text-sm whitespace-pre-wrap">{a.ziel || "—"}</dd>
            </div>
          </dl>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">{worte.auditAnsicht.kategorien}</h2>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          {worte.auditAnsicht.kategorienHinweis}
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
        {!phasen.isLoading && (phasen.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.auditAnsicht.keinePhasen}
          </p>
        ) : (
          <Datentabelle
            zeilen={phasen.data ?? []}
            spalten={phasenSpalten}
            zeilenSchluessel={(p) => p.id}
            vorsortierung={{ spalte: "position", richtung: "auf" }}
            laedt={phasen.isLoading}
            beschriftung={worte.auditAnsicht.phasen}
            unterZeile={(p) =>
              offen === p.id ? (
                <PhasenMaske
                  phase={p}
                  speichert={phaseSpeichern.isPending}
                  onSpeichern={(felder) => phaseSpeichern.mutate({ phase: p, felder })}
                  onAbbrechen={() => setOffen(null)}
                />
              ) : null
            }
          />
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
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
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
                <span className="ms-auto text-[var(--fg-muted)]">{z.wer_email ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Eine Phase bearbeiten — wie im Altsystem unter der Zeile, mit Status,
 * Verantwortlich, Soll- und Ist-Termin und Kommentar (AUD-02).
 *
 * Nichts geht, bevor „Phase speichern" gedrückt ist: kein Speichern beim
 * Verlassen eines Felds. Die zwei Bedingungen der Datenbank sagt die Maske
 * vorher — eine Pflichtphase entfällt nur mit Begründung, „erledigt" braucht
 * einen Ist-Termin (beim Wechsel auf „erledigt" mit heute vorbelegt).
 */
function PhasenMaske({
  phase,
  speichert,
  onSpeichern,
  onAbbrechen,
}: {
  phase: Phase;
  speichert: boolean;
  onSpeichern: (felder: Partial<Phase>) => void;
  onAbbrechen: () => void;
}) {
  const worte = useTexte();
  const auditworte = useAuditworte();
  const [e, setE] = useState({
    status: phase.status,
    verantwortlich: phase.verantwortlich ?? "",
    faellig_am: phase.faellig_am ?? "",
    erledigt_am: phase.erledigt_am ?? "",
    kommentar: phase.kommentar,
    uebersprungen_warum: phase.uebersprungen_warum ?? "",
  });
  const fehler = phasenFehler(e, phase.pflicht);
  const feld = (name: string) => `phase-${phase.id}-${name}`;

  return (
    <div className="space-y-3 py-2">
      {phase.beschreibung && (
        <p className="text-xs text-[var(--fg-muted)]">{phase.beschreibung}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={feld("status")}>{worte.auditAnsicht.status}</Label>
          <Select
            id={feld("status")}
            value={e.status}
            onChange={(ev) => {
              const status = ev.target.value as PhasenStatus;
              setE({
                ...e,
                status,
                erledigt_am: status === "erledigt" && !e.erledigt_am ? heute() : e.erledigt_am,
              });
            }}
          >
            {PHASEN_STATUS.map((s) => (
              <option key={s.wert} value={s.wert}>
                {auditworte[s.wert]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={feld("verantwortlich")}>{worte.auditAnsicht.verantwortlich}</Label>
          <Input
            id={feld("verantwortlich")}
            value={e.verantwortlich}
            maxLength={255}
            onChange={(ev) => setE({ ...e, verantwortlich: ev.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={feld("soll")}>{worte.auditAnsicht.faellig}</Label>
          <Input
            id={feld("soll")}
            type="date"
            value={e.faellig_am}
            onChange={(ev) => setE({ ...e, faellig_am: ev.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={feld("ist")}>{worte.auditAnsicht.erledigtAm}</Label>
          <Input
            id={feld("ist")}
            type="date"
            value={e.erledigt_am}
            onChange={(ev) => setE({ ...e, erledigt_am: ev.target.value })}
          />
          {fehler === "datum" && (
            <span className="text-xs text-[var(--danger)]">{worte.auditAnsicht.datumPflicht}</span>
          )}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={feld("kommentar")}>{worte.auditAnsicht.kommentar}</Label>
          <Input
            id={feld("kommentar")}
            value={e.kommentar}
            onChange={(ev) => setE({ ...e, kommentar: ev.target.value })}
          />
        </div>
        {e.status === "nicht_zutreffend" && (
          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <Label htmlFor={feld("grund")}>
              {worte.auditAnsicht.begruendung}
              {phase.pflicht && <span className="text-[var(--danger)]"> *</span>}
            </Label>
            <Input
              id={feld("grund")}
              value={e.uebersprungen_warum}
              required={phase.pflicht}
              onChange={(ev) => setE({ ...e, uebersprungen_warum: ev.target.value })}
            />
            {fehler === "grund" && (
              <span className="text-xs text-[var(--danger)]">{worte.auditAnsicht.grundPflicht}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={fehler !== null || speichert}
          onClick={() =>
            onSpeichern({
              status: e.status,
              verantwortlich: e.verantwortlich.trim() || null,
              faellig_am: e.faellig_am || null,
              erledigt_am: e.erledigt_am || null,
              kommentar: e.kommentar,
              uebersprungen_warum:
                e.status === "nicht_zutreffend" ? e.uebersprungen_warum.trim() || null : null,
            })
          }
        >
          {worte.auditAnsicht.phaseSpeichern}
        </Button>
        <Button variant="outline" onClick={onAbbrechen}>
          {worte.auditAnsicht.abbrechen}
        </Button>
      </div>
    </div>
  );
}
