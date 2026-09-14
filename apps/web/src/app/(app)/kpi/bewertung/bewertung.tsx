"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  BEREICH_PFAD,
  PRIORITAETEN,
  STATUS_FOLGE,
  bewertungApi,
  bewertungKeys,
  bubblesDesBereichs,
  filtereMassnahmen,
  prioritaetRang,
  type Massnahme,
  type MassnahmeStatus,
  type Prioritaet,
} from "@/lib/kpi/bewertung";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { BubbleMarke } from "@/components/kpi/bubble-ebene";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { cn } from "@/lib/cn";

/** Reihenfolge der Bereiche in der KPI-Auswahl, wie im Altsystem. */
const BEREICH_FOLGE = ["vertrieb", "personal", "qualitaet", "finanzen", "einkauf", "produktion"];

/**
 * KPI-Bewertung & Maßnahmen, aufgebaut wie im Altsystem (`KpiReviewPage`):
 * oben die Bubbles aller Dashboards, darunter das Formular für eine neue
 * Maßnahme, darunter alle Maßnahmen über alle Kennzahlen mit Statusfilter.
 *
 * Bubbles und Formular sieht, wer schreiben darf; die Tabelle sehen alle mit
 * `kpi`, für die anderen ohne Bedienelemente. Die Tabelle bearbeitet direkt
 * in der Zeile — so macht es auch das Altsystem, dort gibt es keine
 * Leseansicht mit eigenem „Bearbeiten“ (EDIT-01 greift hier nicht).
 */
export function BewertungSeite({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const t = worte.bewertung;
  const tag = ZAHL_TAG[useSprache()];
  const qc = useQueryClient();

  const uebersicht = useQuery({ queryKey: bewertungKeys.uebersicht(), queryFn: bewertungApi.uebersicht });
  const bubbles = useQuery({ queryKey: bewertungKeys.bubbles(), queryFn: bewertungApi.bubbles });
  const massnahmen = useQuery({ queryKey: bewertungKeys.massnahmen(), queryFn: bewertungApi.massnahmen });
  const verantwortliche = useQuery({
    queryKey: bewertungKeys.verantwortliche(),
    queryFn: bewertungApi.verantwortliche,
    enabled: darfSchreiben,
  });

  const kennzahlenDaten = uebersicht.data;
  const kennzahlen = useMemo(() => kennzahlenDaten ?? [], [kennzahlenDaten]);
  const bubbleDaten = bubbles.data;
  const alleBubbles = useMemo(() => bubbleDaten ?? [], [bubbleDaten]);
  const massnahmenDaten = massnahmen.data;
  const alleMassnahmen = useMemo(() => massnahmenDaten ?? [], [massnahmenDaten]);
  const namen = useMemo(() => verantwortliche.data ?? [], [verantwortliche.data]);

  const kpiName = useMemo(() => new Map(kennzahlen.map((k) => [k.schluessel, k.label])), [kennzahlen]);
  const kpiBereich = useMemo(() => new Map(kennzahlen.map((k) => [k.schluessel, k.bereich])), [kennzahlen]);

  const datum = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(tag, { dateStyle: "medium" }).format(new Date(iso)) : "—";

  // Alles unter ["kpi", "bewertung"] — auch die Zahl am Maßnahmen-Knopf oben.
  const nachAenderung = () => qc.invalidateQueries({ queryKey: ["kpi", "bewertung"] });
  const fehler = (e: Error) => toast.error(e.message);

  // ── Neue Maßnahme ──
  const [kpi, setKpi] = useState("");
  const [bubbleId, setBubbleId] = useState("");
  const [titel, setTitel] = useState("");
  const [zustaendig, setZustaendig] = useState("");
  const [faellig, setFaellig] = useState("");
  const [prioritaet, setPrioritaet] = useState<Prioritaet>("mittel");
  const bubbleAuswahl = bubblesDesBereichs(alleBubbles, kpiBereich.get(kpi) ?? null);

  const anlegen = useMutation({
    mutationFn: () =>
      bewertungApi.massnahmeAnlegen({
        schluessel: kpi,
        kommentar_id: bubbleId || null,
        titel: titel.trim(),
        zustaendig: zustaendig || null,
        faellig_am: faellig || null,
        prioritaet,
      }),
    onSuccess: () => {
      setBubbleId("");
      setTitel("");
      setZustaendig("");
      setFaellig("");
      setPrioritaet("mittel");
      return nachAenderung();
    },
    onError: fehler,
  });

  const aendern = useMutation({
    mutationFn: (v: { id: string; felder: Parameters<typeof bewertungApi.massnahmeAendern>[1] }) =>
      bewertungApi.massnahmeAendern(v.id, v.felder),
    onSuccess: nachAenderung,
    onError: fehler,
  });
  const massnahmeLoeschen = useMutation({
    mutationFn: bewertungApi.massnahmeLoeschen,
    onSuccess: nachAenderung,
    onError: fehler,
  });
  const bubbleGesehen = useMutation({ mutationFn: bewertungApi.bubbleGesehen, onSuccess: nachAenderung });
  const bubbleLoeschen = useMutation({
    mutationFn: bewertungApi.bubbleLoeschen,
    onSuccess: nachAenderung,
    onError: fehler,
  });

  // ── Tabelle ──
  const [filter, setFilter] = useState<MassnahmeStatus | "alle">("alle");
  const gefiltert = useMemo(() => filtereMassnahmen(alleMassnahmen, filter), [alleMassnahmen, filter]);

  const spalten = useMemo<Tabellenspalte<Massnahme>[]>(() => {
    const liste: Tabellenspalte<Massnahme>[] = [
      {
        schluessel: "kpi",
        titel: t.spalte.kpi,
        typ: "text",
        wert: (m) => kpiName.get(m.schluessel) ?? m.schluessel,
        className: "whitespace-nowrap text-xs text-[var(--fg-muted)]",
      },
      {
        schluessel: "massnahme",
        titel: t.spalte.massnahme,
        typ: "text",
        wert: (m) => m.titel,
        className: "font-medium",
      },
      {
        schluessel: "verantwortlich",
        titel: t.spalte.verantwortlich,
        typ: "text",
        wert: (m) => m.zustaendig,
        className: "min-w-44",
        zelle: (m) =>
          darfSchreiben ? (
            <Select
              aria-label={`${t.spalte.verantwortlich}: ${m.titel}`}
              className="h-8 text-sm"
              value={m.zustaendig ?? ""}
              onChange={(e) => aendern.mutate({ id: m.id, felder: { zustaendig: e.target.value || null } })}
            >
              <option value="">{t.verantwortlichWaehlen}</option>
              {/* Wer nicht mehr in Personio steht, bleibt sichtbar zugewiesen. */}
              {m.zustaendig && !namen.includes(m.zustaendig) && <option value={m.zustaendig}>{m.zustaendig}</option>}
              {namen.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          ) : (
            (m.zustaendig ?? t.nichtZugewiesen)
          ),
      },
      {
        schluessel: "faellig",
        titel: t.spalte.faellig,
        typ: "datum",
        wert: (m) => m.faellig_am,
        suchtext: (m) => datum(m.faellig_am),
        zelle: (m) =>
          darfSchreiben ? (
            <Input
              type="date"
              aria-label={`${t.spalte.faellig}: ${m.titel}`}
              className="h-8 w-36 text-xs"
              value={m.faellig_am ?? ""}
              onChange={(e) => aendern.mutate({ id: m.id, felder: { faellig_am: e.target.value || null } })}
            />
          ) : (
            <span className="whitespace-nowrap">{datum(m.faellig_am)}</span>
          ),
      },
      {
        schluessel: "prioritaet",
        titel: t.spalte.prioritaet,
        typ: "zahl",
        wert: (m) => prioritaetRang(m.prioritaet),
        suchtext: (m) => t.prioritaet[m.prioritaet],
        zelle: (m) =>
          darfSchreiben ? (
            <Select
              aria-label={`${t.spalte.prioritaet}: ${m.titel}`}
              className="h-8 w-auto text-xs"
              value={m.prioritaet}
              onChange={(e) => aendern.mutate({ id: m.id, felder: { prioritaet: e.target.value as Prioritaet } })}
            >
              {PRIORITAETEN.map((p) => (
                <option key={p} value={p}>
                  {t.prioritaet[p]}
                </option>
              ))}
            </Select>
          ) : (
            t.prioritaet[m.prioritaet]
          ),
      },
      {
        schluessel: "status",
        titel: t.spalte.status,
        typ: "text",
        wert: (m) => t.status[m.status],
        zelle: (m) =>
          darfSchreiben ? (
            <Select
              aria-label={`${t.spalte.status}: ${m.titel}`}
              className="h-8 w-auto text-xs"
              value={m.status}
              onChange={(e) => aendern.mutate({ id: m.id, felder: { status: e.target.value as MassnahmeStatus } })}
            >
              {STATUS_FOLGE.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </Select>
          ) : (
            <Badge variant={m.status === "offen" ? "default" : m.status === "laeuft" ? "secondary" : "outline"}>
              {t.status[m.status]}
            </Badge>
          ),
      },
    ];
    if (darfSchreiben) {
      liste.push({
        schluessel: "aktionen",
        titel: t.spalte.aktionen,
        typ: "text",
        wert: () => null,
        suchtext: false,
        sortierbar: false,
        ausrichtung: "end",
        zelle: (m) => (
          <ConfirmDeleteButton itemLabel={m.titel} onConfirm={() => massnahmeLoeschen.mutateAsync(m.id)} />
        ),
      });
    }
    return liste;
    // `aendern` und `massnahmeLoeschen` wechseln bei jedem Rendern die Identität;
    // ihre `mutate`-Funktionen bleiben stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, kpiName, namen, darfSchreiben, tag]);

  const ladeFehler = uebersicht.error ?? bubbles.error ?? massnahmen.error;

  return (
    <div className="space-y-6">

      {ladeFehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">{t.uebersichtFehler((ladeFehler as Error).message)}</Card>
      )}

      {!darfSchreiben && <Card className="p-4 text-sm text-[var(--fg-muted)]">{t.nurLesen}</Card>}

      {darfSchreiben && (
        <Card className="p-5">
          <h3 className="font-medium">
            {t.bubbles} <span className="text-sm font-normal text-[var(--fg-muted)]">({alleBubbles.length})</span>
          </h3>
          {!bubbles.isLoading && alleBubbles.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--fg-muted)]">{t.bubblesLeer}</p>
          )}
          {alleBubbles.length > 0 && (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {alleBubbles.map((b) => {
                const bereichName = t.bereiche[b.bereich as keyof typeof t.bereiche] ?? b.bereich;
                return (
                  <li
                    key={b.id}
                    className={cn("flex items-start gap-3 rounded-md px-1 py-2.5", !b.gesehen_am && "bg-[var(--muted)]")}
                  >
                    <button
                      type="button"
                      onClick={() => !b.gesehen_am && bubbleGesehen.mutate(b.id)}
                      title={b.gesehen_am ? undefined : t.alsGesehen}
                      className="flex min-w-0 flex-1 items-start gap-3 text-start"
                    >
                      <BubbleMarke nummer={b.nummer} ampel={b.ampel} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--fg-muted)]">
                          {!b.gesehen_am && (
                            <span className="inline-block h-2 w-2 rounded-full bg-[var(--fg)]" aria-label={t.neu} />
                          )}
                          <span className="font-medium">{bereichName}</span>
                          <span>
                            {b.verfasser_email ? `· ${b.verfasser_email} ` : ""}· {datum(b.erstellt_am)}
                          </span>
                          {b.pos_x == null && <span>· {t.ohnePosition}</span>}
                        </span>
                        <span className="mt-0.5 block whitespace-pre-wrap text-sm">{b.text}</span>
                      </span>
                    </button>
                    {BEREICH_PFAD[b.bereich] && (
                      <Link
                        href={BEREICH_PFAD[b.bereich]}
                        aria-label={`${t.zumDashboard}: ${bereichName}`}
                        title={t.zumDashboard}
                        className="mt-1.5 shrink-0 text-[var(--fg-muted)] hover:text-[var(--fg)]"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </Link>
                    )}
                    <ConfirmDeleteButton
                      itemLabel={`${bereichName} · ${t.bubble(b.nummer)}`}
                      onConfirm={() => bubbleLoeschen.mutateAsync(b.id)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {darfSchreiben && (
        <Card className="space-y-2 p-5">
          <h3 className="mb-1 font-medium">{t.neueMassnahme}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              aria-label={t.spalte.kpi}
              value={kpi}
              onChange={(e) => {
                setKpi(e.target.value);
                setBubbleId("");
              }}
            >
              <option value="">{t.kpiWaehlen}</option>
              {BEREICH_FOLGE.filter((b) => kennzahlen.some((k) => k.bereich === b)).map((b) => (
                <optgroup key={b} label={t.bereiche[b as keyof typeof t.bereiche] ?? b}>
                  {kennzahlen
                    .filter((k) => k.bereich === b)
                    .map((k) => (
                      <option key={k.schluessel} value={k.schluessel}>
                        {k.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
            <Select
              aria-label={t.bubbles}
              value={bubbleId}
              disabled={!kpi || bubbleAuswahl.length === 0}
              onChange={(e) => setBubbleId(e.target.value)}
            >
              <option value="">{t.ohneBubble}</option>
              {bubbleAuswahl.map((b) => (
                <option key={b.id} value={b.id}>
                  #{b.nummer} — {b.text.slice(0, 40)}
                </option>
              ))}
            </Select>
          </div>
          <Input
            aria-label={t.spalte.massnahme}
            value={titel}
            placeholder={t.titelPlatzhalter}
            onChange={(e) => setTitel(e.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <Select
              aria-label={t.spalte.verantwortlich}
              value={zustaendig}
              onChange={(e) => setZustaendig(e.target.value)}
            >
              <option value="">{t.verantwortlichWaehlen}</option>
              {namen.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              aria-label={t.spalte.faellig}
              className="sm:w-40"
              value={faellig}
              onChange={(e) => setFaellig(e.target.value)}
            />
            <Select
              aria-label={t.spalte.prioritaet}
              className="sm:w-32"
              value={prioritaet}
              onChange={(e) => setPrioritaet(e.target.value as Prioritaet)}
            >
              {PRIORITAETEN.map((p) => (
                <option key={p} value={p}>
                  {t.prioritaet[p]}
                </option>
              ))}
            </Select>
            <Button disabled={!kpi || !titel.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
              <Plus className="h-4 w-4" aria-hidden /> {t.anlegen}
            </Button>
          </div>
        </Card>
      )}

      <Card className="space-y-3 p-5">
        <h3 className="font-medium">
          {t.massnahmen} <span className="text-sm font-normal text-[var(--fg-muted)]">({gefiltert.length})</span>
        </h3>
        <Datentabelle
          zeilen={gefiltert}
          spalten={spalten}
          zeilenSchluessel={(m) => m.id}
          laedt={massnahmen.isLoading || uebersicht.isLoading}
          leer={t.keineMassnahme}
          beschriftung={t.massnahmen}
          werkzeuge={
            <Select
              aria-label={t.statusFilter}
              className="h-8 w-auto text-xs"
              value={filter}
              onChange={(e) => setFilter(e.target.value as MassnahmeStatus | "alle")}
            >
              <option value="alle">{t.alleStatus}</option>
              {STATUS_FOLGE.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </Select>
          }
        />
      </Card>
    </div>
  );
}
