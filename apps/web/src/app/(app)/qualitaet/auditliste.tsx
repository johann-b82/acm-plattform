"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AUDIT_STATUS,
  KATEGORIEN,
  anlageFehler,
  auditApi,
  auditKeys,
  filtereAudits,
  fortschritt,
  type Audit,
  type Kategorie,
  type NeuesAudit,
  type Stand,
} from "@/lib/audit";
import { Badge, Button, Card, EmptyState, Input, Label, Select } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { Seitenwerkzeuge, Werkzeug, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { useAuditworte } from "@/lib/tafeln";

/** Ein Audit gilt als laufend, solange es nicht abgeschlossen oder abgesagt ist. */
const LAEUFT = new Set(["geplant", "in_vorbereitung", "in_durchfuehrung", "berichtet", "massnahmen_offen"]);

/** Wie im Altsystem: ein neues Audit ist zunächst ein Prozessaudit. */
const LEER: NeuesAudit = {
  nummer: "",
  titel: "",
  art: "intern",
  kategorien: ["prozess"],
  bereich: "",
  leitender_auditor: "",
  geplant_von: "",
  geplant_bis: "",
  vorlage_id: "",
};

/**
 * Die Auditübersicht.
 *
 * Aufbau wie im Altsystem (AUD-04): die Filter Status und Art und „Neues
 * Audit", darunter bei Bedarf das Anlageformular. Die Filter wirken auf den
 * ganzen Bestand, bevor die Tabelle sucht, sortiert und blättert. In der
 * Schale stehen Filter und Knopf deshalb untereinander in der rechten Leiste;
 * ohne Schale in einer Zeile über der Liste.
 */
export function Auditliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const auditworte = useAuditworte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const router = useRouter();
  const [filter, setFilter] = useState({ status: "", art: "" });
  const [formular, setFormular] = useState(false);
  const [neu, setNeu] = useState<NeuesAudit>(LEER);

  const audits = useQuery({ queryKey: auditKeys.liste(), queryFn: auditApi.liste });
  const stand = useQuery({ queryKey: auditKeys.stand(), queryFn: auditApi.stand });
  const vorlagen = useQuery({ queryKey: auditKeys.vorlagen(), queryFn: auditApi.vorlagen });
  const kategorien = useQuery({
    queryKey: auditKeys.alleKategorien(),
    queryFn: auditApi.alleKategorien,
  });

  const standNach = useMemo(() => {
    const m = new Map<string, Stand>();
    for (const s of stand.data ?? []) m.set(s.audit_id, s);
    return m;
  }, [stand.data]);

  const kategorienNach = useMemo(() => {
    const m = new Map<string, Kategorie[]>();
    for (const k of kategorien.data ?? []) {
      m.set(k.audit_id, [...(m.get(k.audit_id) ?? []), k.kategorie]);
    }
    return m;
  }, [kategorien.data]);

  // Gemerkt: eine neue Menge schickt die Tabelle auf Seite 1 — das soll nur
  // beim Filterwechsel passieren, nicht bei jedem Rendern.
  const auditDaten = audits.data;
  const gefiltert = useMemo(() => filtereAudits(auditDaten ?? [], filter), [auditDaten, filter]);

  const fehler = anlageFehler(neu);

  const anlegen = useMutation({
    mutationFn: () => auditApi.anlegen(neu),
    onSuccess: (id: string) => {
      toast.success(worte.audit.angelegt);
      setNeu(LEER);
      setFormular(false);
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      router.push(`/qualitaet/${id}`);
    },
    onError: (f: Error) =>
      toast.error(
        /duplicate|unique/i.test(f.message)
          ? worte.audit.nummerVergeben
          : /audits_zeitraum/.test(f.message)
            ? worte.audit.zeitraumFehler
            : f.message,
      ),
  });

  const liste = auditDaten ?? [];
  const laufend = liste.filter((a) => LAEUFT.has(a.status));

  const spalten: Tabellenspalte<Audit>[] = [
    {
      schluessel: "nummer",
      titel: worte.audit.nummer,
      typ: "text",
      wert: (a) => a.nummer,
      zelle: (a) => (
        <Link
          href={`/qualitaet/${a.id}`}
          className="font-medium tabular-nums underline-offset-4 hover:underline"
        >
          {a.nummer}
        </Link>
      ),
    },
    { schluessel: "titel", titel: worte.audit.titel, typ: "text", wert: (a) => a.titel },
    { schluessel: "art", titel: worte.audit.art, typ: "text", wert: (a) => auditworte[a.art] ?? a.art },
    {
      schluessel: "kategorie",
      titel: worte.audit.kategorie,
      typ: "text",
      wert: (a) => (kategorienNach.get(a.id) ?? []).map((k) => auditworte[k]).join(" + "),
    },
    { schluessel: "bereich", titel: worte.audit.geltungsbereich, typ: "text", wert: (a) => a.bereich },
    {
      schluessel: "geplant_von",
      titel: worte.audit.beginnGeplant,
      typ: "datum",
      wert: (a) => a.geplant_von,
      zelle: (a) => (a.geplant_von ? DATUM.format(new Date(a.geplant_von)) : "—"),
    },
    {
      schluessel: "status",
      titel: worte.audit.status,
      typ: "text",
      wert: (a) => auditworte[a.status],
      zelle: (a) => (
        <Badge variant={a.status === "abgeschlossen" ? "secondary" : "outline"}>
          {auditworte[a.status]}
        </Badge>
      ),
    },
    {
      schluessel: "fortschritt",
      titel: worte.audit.fortschritt,
      typ: "zahl",
      wert: (a) => fortschritt(standNach.get(a.id)),
      zelle: (a) => {
        const s = standNach.get(a.id);
        const prozent = fortschritt(s);
        return (
          <span className="tabular-nums">
            {prozent === null ? "—" : `${prozent} %`}
            {s && s.ueberfaellig > 0 && (
              <span className="ms-2 text-[var(--danger)]">{worte.audit.ueberfaellig(s.ueberfaellig)}</span>
            )}
          </span>
        );
      },
    },
    {
      schluessel: "naechster_termin",
      titel: worte.audit.naechsterTermin,
      typ: "datum",
      wert: (a) => standNach.get(a.id)?.naechster_termin ?? null,
      zelle: (a) => {
        const termin = standNach.get(a.id)?.naechster_termin;
        return termin ? DATUM.format(new Date(termin)) : "—";
      },
    },
  ];

  const statusWahl = (
    <Select
      id="filter-status"
      value={filter.status}
      onChange={(e) => setFilter({ ...filter, status: e.target.value })}
    >
      <option value="">{worte.audit.alle}</option>
      {AUDIT_STATUS.map((s) => (
        <option key={s.wert} value={s.wert}>
          {auditworte[s.wert]}
        </option>
      ))}
    </Select>
  );
  const artWahl = (
    <Select id="filter-art" value={filter.art} onChange={(e) => setFilter({ ...filter, art: e.target.value })}>
      <option value="">{worte.audit.alle}</option>
      <option value="intern">{worte.audit.intern}</option>
      <option value="extern">{worte.audit.extern}</option>
    </Select>
  );
  const neuKnopf = darfSchreiben && (
    <Button
      variant="outline"
      className={inSchale ? undefined : "ms-auto"}
      aria-expanded={formular}
      onClick={() => {
        if (formular) setNeu(LEER);
        setFormular(!formular);
      }}
    >
      {formular ? worte.allgemein.abbrechen : worte.audit.neuesAudit}
    </Button>
  );

  return (
    <div className="space-y-6">
      <Seitenkopf
        unter={
          <div className="mt-2 flex justify-start text-sm">
            <Link href="/kpi/qualitaet" className="underline-offset-4 hover:underline">
              {worte.audit.zuKennzahlen}
            </Link>
          </div>
        }
      />

      {/* In der Schale: die Filter mit Titel unter „Filter“, „Neues Audit“ unter „Aktionen“.
          Der Titel ist das Label des Filters, damit keine zweite Beschriftung daneben steht. */}
      {inSchale ? (
        <>
          <Seitenwerkzeuge kategorie="filter">
            <Werkzeug titel={<label htmlFor="filter-status">{worte.audit.status}</label>}>
              {statusWahl}
            </Werkzeug>
            <Werkzeug titel={<label htmlFor="filter-art">{worte.audit.art}</label>}>{artWahl}</Werkzeug>
          </Seitenwerkzeuge>
          {neuKnopf && <Seitenwerkzeuge kategorie="aktionen">{neuKnopf}</Seitenwerkzeuge>}
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="filter-status">{worte.audit.status}</Label>
            {statusWahl}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="filter-art">{worte.audit.art}</Label>
            {artWahl}
          </div>
          {neuKnopf}
        </div>
      )}

      {darfSchreiben && formular && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="nummer">{worte.audit.nummer}</Label>
              <Input
                id="nummer"
                value={neu.nummer}
                required
                maxLength={64}
                placeholder={worte.audit.nummerBeispiel}
                onChange={(e) => setNeu({ ...neu, nummer: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="titel">{worte.audit.titel}</Label>
              <Input
                id="titel"
                value={neu.titel}
                required
                maxLength={255}
                placeholder={worte.audit.titelBeispiel}
                onChange={(e) => setNeu({ ...neu, titel: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bereich">{worte.audit.geltungsbereich}</Label>
              <Input
                id="bereich"
                value={neu.bereich}
                maxLength={255}
                onChange={(e) => setNeu({ ...neu, bereich: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="art">{worte.audit.art}</Label>
              <Select
                id="art"
                value={neu.art}
                onChange={(e) => setNeu({ ...neu, art: e.target.value as NeuesAudit["art"] })}
              >
                <option value="intern">{worte.audit.intern}</option>
                <option value="extern">{worte.audit.extern}</option>
              </Select>
            </div>
            {/* Mehrfachauswahl: ein Audit ist oft Prozess- und Produktaudit zugleich. */}
            <fieldset className="flex flex-col gap-1 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">{worte.audit.kategorie}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {KATEGORIEN.map((k) => (
                  <label key={k.wert} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={neu.kategorien.includes(k.wert)}
                      onChange={(e) =>
                        setNeu({
                          ...neu,
                          kategorien: e.target.checked
                            ? [...neu.kategorien, k.wert]
                            : neu.kategorien.filter((x) => x !== k.wert),
                        })
                      }
                    />
                    {auditworte[k.wert]}
                  </label>
                ))}
              </div>
              {fehler.includes("kategorie") && (
                <span className="text-xs text-[var(--danger)]">{worte.audit.kategoriePflicht}</span>
              )}
            </fieldset>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lead">{worte.audit.leadAuditor}</Label>
              <Input
                id="lead"
                value={neu.leitender_auditor}
                maxLength={255}
                onChange={(e) => setNeu({ ...neu, leitender_auditor: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="beginn">{worte.audit.beginnGeplant}</Label>
              <Input
                id="beginn"
                type="date"
                value={neu.geplant_von}
                onChange={(e) => setNeu({ ...neu, geplant_von: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ende">{worte.audit.endeGeplant}</Label>
              <Input
                id="ende"
                type="date"
                value={neu.geplant_bis}
                min={neu.geplant_von || undefined}
                onChange={(e) => setNeu({ ...neu, geplant_bis: e.target.value })}
              />
              {fehler.includes("zeitraum") && (
                <span className="text-xs text-[var(--danger)]">{worte.audit.zeitraumFehler}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="vorlage">{worte.audit.phasenvorlage}</Label>
              <Select
                id="vorlage"
                value={neu.vorlage_id}
                onChange={(e) => setNeu({ ...neu, vorlage_id: e.target.value })}
              >
                <option value="">{worte.audit.ohneVorlage}</option>
                {(vorlagen.data ?? [])
                  .filter((v) => v.aktiv)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-[var(--fg-muted)]">{worte.audit.vorlageHinweis}</p>
          <Button disabled={fehler.length > 0 || anlegen.isPending} onClick={() => anlegen.mutate()}>
            {worte.allgemein.speichern}
          </Button>
        </Card>
      )}

      {audits.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</Card>
      ) : liste.length === 0 ? (
        <EmptyState title={worte.audit.keinAudit} body={worte.audit.keinAuditText} />
      ) : (
        <>
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.audit.laufen(laufend.length, liste.length)}
          </p>
          <Datentabelle
            zeilen={gefiltert}
            spalten={spalten}
            zeilenSchluessel={(a) => a.id}
            vorsortierung={{ spalte: "geplant_von", richtung: "ab" }}
            leer={worte.audit.keinTreffer}
            beschriftung={worte.pfad.seiten["/qualitaet"]}
          />
        </>
      )}
    </div>
  );
}
