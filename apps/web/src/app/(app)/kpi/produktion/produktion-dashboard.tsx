"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  takt,
} from "@/lib/kpi/gemeinsam";
import { nachAnsicht, produktionApi, type Auftragsansicht, type VerzugZeile } from "@/lib/kpi/produktion";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Card } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { DiagrammartWahl, useDiagrammart } from "@/components/kpi/diagrammart";
import { Seitenkopf } from "@/components/seitenkopf";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { ZAHL_TAG } from "@/lib/sprache";
import { cn } from "@/lib/cn";



function datum(iso: string | null, sprachTag: string): string {
  return iso ? new Date(iso).toLocaleDateString(sprachTag) : "—";
}

/**
 * Welche der beiden Auftragsmengen die Tabelle zeigt (PRO-02). Die Referenz
 * stellte beide Tabellen nebeneinander; hier teilen sie sich die volle Breite.
 */
function Ansichtswahl({
  ansicht,
  onChange,
}: {
  ansicht: Auftragsansicht;
  onChange: (ansicht: Auftragsansicht) => void;
}) {
  const worte = useTexte();
  const stufen: [Auftragsansicht, string][] = [
    ["verzug", worte.produktion.ansichtVerzug],
    ["ueberfaellig", worte.produktion.ansichtUeberfaellig],
  ];
  return (
    <div
      role="radiogroup"
      aria-label={worte.produktion.ansicht}
      className="inline-flex rounded-md border border-[var(--border)] p-0.5"
    >
      {stufen.map(([stufe, label]) => (
        <button
          key={stufe}
          type="button"
          role="radio"
          aria-checked={ansicht === stufe}
          onClick={() => onChange(stufe)}
          className={cn(
            "rounded px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
            ansicht === stufe ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProduktionDashboard() {
  const worte = useTexte();
  const fmt = useFormate();
  const tag = ZAHL_TAG[useSprache()];
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);
  const [art, setArt] = useDiagrammart();
  // Start mit den zu spät gelieferten — sie stehen in der Referenz links und
  // tragen den Namen der Kachel. Die Wahl gilt für den Besuch, nicht dauerhaft.
  const [ansicht, setAnsicht] = useState<Auftragsansicht>("verzug");

  const verzug = useQuery({
    queryKey: ["kpi", "produktion", "verzug", von, bis],
    queryFn: () => produktionApi.verzug(von, bis),
  });
  const vgl = useVergleich(
    ["kpi", "produktion", "verzug"],
    zeitraum,
    von,
    bis,
    produktionApi.verzug,
  );
  const verlauf = useQuery({
    queryKey: ["kpi", "produktion", "verlauf", von, bis],
    queryFn: () => produktionApi.verlauf(von, bis),
  });
  const liste = useQuery({
    queryKey: ["kpi", "produktion", "liste", von, bis],
    queryFn: () => produktionApi.liste(von, bis),
  });
  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const ziel = nachSchluessel(ziele.data ?? [])["produktion_verzug"];

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      (verlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        quote: p.quote == null ? null : Number(p.quote) * 100,
        gesamt: p.gesamt,
      })),
    [verlaufDaten, t, fmt],
  );

  const listenDaten = liste.data;
  const zeilen = useMemo(() => nachAnsicht(listenDaten ?? [], ansicht), [listenDaten, ansicht]);
  const offene = verzug.data?.offen ?? 0;

  const spalten = useMemo<Tabellenspalte<VerzugZeile>[]>(() => {
    const auftrag: Tabellenspalte<VerzugZeile> = {
      schluessel: "auftrag",
      titel: worte.produktion.auftrag,
      typ: "text",
      wert: (z) => z.vorgang_nr,
      zelle: (z) => <span className="font-mono text-xs">{z.vorgang_nr}</span>,
    };
    const kunde: Tabellenspalte<VerzugZeile> = {
      schluessel: "kunde",
      titel: worte.produktion.kunde,
      typ: "text",
      wert: (z) => z.customer_name,
      suchtext: (z) => `${z.customer_name ?? ""} ${z.adr_nr ?? ""}`,
      zelle: (z) => (
        <>
          {z.customer_name ?? "—"}
          {z.adr_nr && <span className="ms-1 text-xs text-[var(--fg-muted)]">({z.adr_nr})</span>}
        </>
      ),
    };
    const zieltermin: Tabellenspalte<VerzugZeile> = {
      schluessel: "zieltermin",
      titel: worte.produktion.zieltermin,
      typ: "datum",
      wert: (z) => z.ziel,
      zelle: (z) => datum(z.ziel, tag),
      suchtext: false,
      ausrichtung: "end",
    };
    // Derselbe Schlüssel in beiden Ansichten: die Sortierung bleibt beim Umschalten.
    const tage = (titel: string): Tabellenspalte<VerzugZeile> => ({
      schluessel: "verzug",
      titel,
      typ: "zahl",
      wert: (z) => z.verzug_tage,
      zelle: (z) => <span className="text-[var(--danger)]">+{fmt.zahl(z.verzug_tage)} d</span>,
      suchtext: false,
      ausrichtung: "end",
    });
    if (ansicht === "ueberfaellig") {
      return [auftrag, kunde, zieltermin, tage(worte.produktion.tageUeberfaellig)];
    }
    return [
      auftrag,
      kunde,
      zieltermin,
      {
        schluessel: "geliefert",
        titel: worte.produktion.geliefert,
        typ: "datum",
        wert: (z) => z.ist,
        zelle: (z) => datum(z.ist, tag),
        suchtext: false,
        ausrichtung: "end",
      },
      tage(worte.produktion.verzug),
    ];
  }, [ansicht, worte, fmt, tag]);

  const keineDaten = !verzug.isLoading && verzug.data?.gesamt === 0;
  const fehler = verzug.error ?? verlauf.error ?? liste.error ?? ziele.error;
  const ansichtName =
    ansicht === "verzug" ? worte.produktion.ansichtVerzug : worte.produktion.ansichtUeberfaellig;

  return (
    <div className="space-y-6">
      <Seitenkopf
        bedienung={
          <>
            <Zeitraumwahl wahl={wahl} datenstand={<Datenstand bereich="produktion" />} />
          </>
        }
      />

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {worte.dashboard.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      {keineDaten && (
        <Card className="p-8 text-center">
          <p className="font-medium">{worte.produktion.keineDaten}</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.produktion.ladeVor}
            <Link href="/uploads" className="underline underline-offset-4">
              {worte.pfad.seiten["/uploads"]}
            </Link>
            {worte.produktion.ladeNach}
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kennzahl
          titel={worte.produktion.quote}
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={fmt.prozent(verzug.data?.quote == null ? null : Number(verzug.data.quote))}
          hinweis={worte.produktion.quoteHinweis(fmt.prozent(ziel))}
          laedt={verzug.isLoading}
          vergleich={
            <Vergleiche
              aktuell={verzug.data?.quote == null ? null : Number(verzug.data.quote)}
              vorperiode={vgl.vorperiode?.quote == null ? null : Number(vgl.vorperiode.quote)}
              vorjahr={vgl.vorjahr?.quote == null ? null : Number(vgl.vorjahr.quote)}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.produktion.inVerzug}
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={fmt.zahl(verzug.data?.in_verzug)}
          hinweis={offene > 0 ? worte.produktion.davonOffen(fmt.zahl(offene)) : undefined}
          laedt={verzug.isLoading}
          vergleich={
            <Vergleiche
              aktuell={verzug.data?.in_verzug}
              vorperiode={vgl.vorperiode?.in_verzug}
              vorjahr={vgl.vorjahr?.in_verzug}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.produktion.gesamt}
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={fmt.zahl(verzug.data?.gesamt)}
          hinweis={worte.produktion.gesamtHinweis}
          laedt={verzug.isLoading}
        />
        <Kennzahl
          titel={worte.produktion.verzugSchnitt}
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={
            verzug.data?.verzug_schnitt == null
              ? "—"
              : `${Number(verzug.data.verzug_schnitt) > 0 ? "+" : ""}${(
                  Math.round(Number(verzug.data.verzug_schnitt) * 10) / 10
                ).toLocaleString("de-DE")} d`
          }
          hinweis={worte.produktion.verzugHinweis}
          laedt={verzug.isLoading}
        />
      </div>

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-medium">{worte.produktion.verlauf}</h2>
              <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
                {worte.produktion.verlaufHinweis}
              </p>
            </div>
            <DiagrammartWahl art={art} onChange={setArt} />
          </div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              {/* Rechter Rand trägt die Beschriftung der Ziellinie. */}
              <ComposedChart data={chartDaten} margin={{ top: 8, right: 56, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--fg-muted)" />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  stroke="var(--fg-muted)"
                  tickFormatter={(v: number) => `${v} %`}
                  width={56}
                />
                <Tooltip
                  formatter={(wert, _name, eintrag) => {
                    const zahl = typeof wert === "number" ? wert : null;
                    const gesamt = (eintrag?.payload as { gesamt?: number } | undefined)?.gesamt ?? 0;
                    return [
                      zahl == null ? "—" : fmt.prozent(zahl / 100),
                      worte.produktion.verlaufTooltip(fmt.zahl(gesamt)),
                    ] as [string, string];
                  }}
                />
                {art === "balken" ? (
                  <Bar dataKey="quote" fill="var(--accent, #2f6f8f)" isAnimationActive={false} />
                ) : (
                  <Area
                    type="monotone"
                    dataKey="quote"
                    stroke="var(--accent, #2f6f8f)"
                    strokeWidth={2}
                    fill="var(--accent, #2f6f8f)"
                    fillOpacity={0.2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
                {ziel != null && (
                <ReferenceLine
                  y={ziel * 100}
                  stroke="var(--fg-muted)"
                  strokeDasharray="4 4"
                  label={{
                    value: worte.produktion.ziellinie,
                    position: "right",
                    fontSize: 11,
                    fill: "var(--fg-muted)",
                  }}
                />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {!keineDaten && (
        <Card className="p-5">
          <Datentabelle
            zeilen={zeilen}
            spalten={spalten}
            zeilenSchluessel={(z) => z.vorgang_nr}
            vorsortierung={{ spalte: "verzug", richtung: "ab" }}
            laedt={liste.isLoading}
            leer={ansicht === "verzug" ? worte.produktion.leerVerzug : worte.produktion.leerUeberfaellig}
            beschriftung={ansichtName}
            werkzeuge={
              <>
                <Ansichtswahl ansicht={ansicht} onChange={setAnsicht} />
                <span className="text-sm text-[var(--fg-muted)]">
                  {ansicht === "verzug" ? worte.produktion.hinweisVerzug : worte.produktion.hinweisUeberfaellig}
                </span>
              </>
            }
          />
        </Card>
      )}
    </div>
  );
}
