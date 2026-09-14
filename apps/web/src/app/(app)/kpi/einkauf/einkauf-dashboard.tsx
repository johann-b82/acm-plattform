"use client";

import { useMemo } from "react";
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
import {
  LIEGETAGE,
  einkaufApi,
  gebundenesKapital,
  ladenhueterApi,
  verzugText,
  type LadenhueterZeile,
  type OtdPosition,
} from "@/lib/kpi/einkauf";
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

export function EinkaufDashboard() {
  const worte = useTexte();
  const fmt = useFormate();
  const tag = ZAHL_TAG[useSprache()];
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);
  const [art, setArt] = useDiagrammart();

  const otd = useQuery({
    queryKey: ["kpi", "einkauf", "otd", von, bis],
    queryFn: () => einkaufApi.otd(von, bis),
  });
  const vgl = useVergleich(["kpi", "einkauf", "otd"], zeitraum, von, bis, einkaufApi.otd);
  const verlauf = useQuery({
    queryKey: ["kpi", "einkauf", "verlauf", von, bis],
    queryFn: () => einkaufApi.verlauf(von, bis),
  });
  const positionen = useQuery({
    queryKey: ["kpi", "einkauf", "positionen", von, bis],
    queryFn: () => einkaufApi.positionen(von, bis),
  });
  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const ladenhueter = useQuery({
    // Ohne Zeitraum im Schlüssel: der Bestand ist ein Stichtagswert.
    queryKey: ["kpi", "einkauf", "ladenhueter"],
    queryFn: () => ladenhueterApi.alle(),
  });
  const ziel = nachSchluessel(ziele.data ?? [])["einkauf_otd"];

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      (verlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        // Recharts unterbricht Fläche und Balken bei null — genau das ist
        // gewollt: ein Bucket ohne Positionen hat keine Quote, keine Null.
        quote: p.quote == null ? null : Number(p.quote) * 100,
        gesamt: p.gesamt,
      })),
    [verlaufDaten, t, fmt],
  );

  const zeilenDaten = positionen.data;
  const zeilen = useMemo(() => zeilenDaten ?? [], [zeilenDaten]);
  const lagerDaten = ladenhueter.data;
  const lager = useMemo(() => lagerDaten ?? [], [lagerDaten]);

  const positionsSpalten = useMemo<Tabellenspalte<OtdPosition>[]>(() => {
    const menge = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
    return [
      {
        schluessel: "auftrag",
        titel: worte.einkauf.auftrag,
        typ: "text",
        wert: (z) => `${z.auftrag}/${z.pos}${z.upos ? `/${z.upos}` : ""}`,
        zelle: (z) => (
          <span className="font-mono text-xs">
            {z.auftrag}/{z.pos}
            {z.upos ? `/${z.upos}` : ""}
          </span>
        ),
      },
      {
        schluessel: "lieferant",
        titel: worte.einkauf.lieferant,
        typ: "text",
        wert: (z) => z.supplier_name,
        suchtext: (z) => `${z.supplier_name ?? ""} ${z.adr_nr ?? ""}`,
        zelle: (z) => (
          <>
            {z.supplier_name ?? "—"}
            {z.adr_nr && <span className="ms-1 text-xs text-[var(--fg-muted)]">({z.adr_nr})</span>}
          </>
        ),
      },
      {
        schluessel: "artikel",
        titel: worte.einkauf.artikel,
        typ: "text",
        wert: (z) => z.article_name ?? z.article_number,
        suchtext: (z) => `${z.article_number ?? ""} ${z.article_name ?? ""}`,
      },
      {
        schluessel: "geliefert",
        titel: worte.einkauf.geliefert,
        typ: "datum",
        wert: (z) => z.delivered_date,
        zelle: (z) => datum(z.delivered_date, tag),
        suchtext: false,
        ausrichtung: "end",
      },
      {
        schluessel: "zieltermin",
        titel: worte.einkauf.zieltermin,
        typ: "datum",
        wert: (z) => z.target_date,
        zelle: (z) => datum(z.target_date, tag),
        suchtext: false,
        ausrichtung: "end",
      },
      {
        schluessel: "verzug",
        titel: worte.einkauf.verzug,
        typ: "zahl",
        wert: (z) => z.verzug_tage,
        zelle: (z) => (
          <span className={cn(z.verzug_tage != null && z.verzug_tage > 0 && "text-[var(--danger)]")}>
            {verzugText(z.verzug_tage)}
          </span>
        ),
        suchtext: false,
        ausrichtung: "end",
      },
      {
        schluessel: "menge",
        titel: worte.einkauf.menge,
        typ: "zahl",
        wert: (z) => z.quantity,
        // Ganze Zahl wie in der Referenz; die Einheit dazu, weil Stück, Meter
        // und Quadratmeter in derselben Spalte stehen.
        zelle: (z) => (z.quantity == null ? "—" : `${menge.format(z.quantity)}${z.unit ? ` ${z.unit}` : ""}`),
        suchtext: false,
        ausrichtung: "end",
      },
    ];
  }, [worte, tag]);

  const lagerSpalten = useMemo<Tabellenspalte<LadenhueterZeile>[]>(
    () => [
      {
        schluessel: "artnr",
        titel: worte.einkauf.artikel,
        typ: "text",
        wert: (z) => z.artnr,
        zelle: (z) => <span className="font-mono text-xs">{z.artnr}</span>,
      },
      {
        schluessel: "bezeichnung",
        titel: worte.einkauf.bezeichnung,
        typ: "text",
        wert: (z) => z.article_name,
        className: "max-w-sm truncate",
      },
      {
        schluessel: "bestand",
        titel: worte.einkauf.bestand,
        typ: "zahl",
        wert: (z) => z.bestand,
        zelle: (z) => fmt.zahl(z.bestand),
        suchtext: false,
        ausrichtung: "end",
      },
      {
        schluessel: "liegtSeit",
        titel: worte.einkauf.liegtSeit,
        typ: "zahl",
        wert: (z) => z.tage_liegend,
        zelle: (z) => `${fmt.zahl(z.tage_liegend)} d`,
        suchtext: false,
        ausrichtung: "end",
      },
      {
        schluessel: "stueckpreis",
        titel: worte.einkauf.stueckpreis,
        typ: "zahl",
        wert: (z) => z.stueckpreis,
        zelle: (z) => fmt.eurGenau(z.stueckpreis),
        suchtext: false,
        ausrichtung: "end",
      },
      {
        schluessel: "wert",
        titel: worte.einkauf.wert,
        typ: "zahl",
        wert: (z) => z.wert,
        zelle: (z) => fmt.eur(z.wert),
        suchtext: false,
        ausrichtung: "end",
      },
    ],
    [worte, fmt],
  );

  const keineDaten = !otd.isLoading && otd.data?.gesamt === 0;
  const fehler = otd.error ?? verlauf.error ?? positionen.error ?? ziele.error ?? ladenhueter.error;

  return (
    <div className="space-y-6">
      <Seitenkopf
        bedienung={
          <>
            <Zeitraumwahl wahl={wahl} datenstand={<Datenstand bereich="einkauf" />} />
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
          <p className="font-medium">{worte.einkauf.keineDaten}</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.einkauf.ladeVor}
            <Link href="/uploads" className="underline underline-offset-4">
              {worte.pfad.seiten["/uploads"]}
            </Link>
            {worte.einkauf.ladeNach}
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kennzahl
          titel={worte.einkauf.otd}
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={fmt.prozent(otd.data?.quote == null ? null : Number(otd.data.quote))}
          hinweis={worte.einkauf.otdHinweis(fmt.prozent(ziel))}
          laedt={otd.isLoading}
          vergleich={
            <Vergleiche
              aktuell={otd.data?.quote == null ? null : Number(otd.data.quote)}
              vorperiode={vgl.vorperiode?.quote == null ? null : Number(vgl.vorperiode.quote)}
              vorjahr={vgl.vorjahr?.quote == null ? null : Number(vgl.vorjahr.quote)}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
              richtung="mehr_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.einkauf.puenktlich}
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={fmt.zahl(otd.data?.puenktlich)}
          laedt={otd.isLoading}
        />
        <Kennzahl
          titel={worte.einkauf.gesamt}
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={fmt.zahl(otd.data?.gesamt)}
          laedt={otd.isLoading}
        />
        <Kennzahl
          titel={worte.einkauf.verzugSchnitt}
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={verzugText(otd.data?.verzug_schnitt == null ? null : Number(otd.data.verzug_schnitt))}
          hinweis={worte.einkauf.verzugHinweis}
          laedt={otd.isLoading}
          vergleich={
            <Vergleiche
              aktuell={otd.data?.verzug_schnitt == null ? null : Number(otd.data.verzug_schnitt)}
              vorperiode={
                vgl.vorperiode?.verzug_schnitt == null ? null : Number(vgl.vorperiode.verzug_schnitt)
              }
              vorjahr={vgl.vorjahr?.verzug_schnitt == null ? null : Number(vgl.vorjahr.verzug_schnitt)}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
              richtung="weniger_ist_besser"
            />
          }
        />
      </div>

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-medium">{worte.einkauf.verlauf}</h2>
              <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
                {worte.einkauf.verlaufHinweis}
              </p>
            </div>
            <DiagrammartWahl art={art} onChange={setArt} />
          </div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              {/* Rechter Rand traegt die Beschriftung der Ziellinie. */}
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
                      worte.einkauf.verlaufTooltip(fmt.zahl(gesamt)),
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
                  label={{ value: worte.einkauf.ziellinie, position: "right", fontSize: 11, fill: "var(--fg-muted)" }}
                />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {zeilen.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.einkauf.positionen}</h2>
          <p className="mt-0.5 mb-4 text-sm text-[var(--fg-muted)]">
            {worte.einkauf.positionenHinweis}
          </p>
          <Datentabelle
            zeilen={zeilen}
            spalten={positionsSpalten}
            zeilenSchluessel={(z) => `${z.auftrag}-${z.pos}-${z.upos}`}
            beschriftung={worte.einkauf.positionen}
          />
        </Card>
      )}

      {lager.length > 0 && (
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">{worte.einkauf.ladenhueter}</h2>
            <span className="text-sm text-[var(--fg-muted)]">
              {worte.einkauf.kapital(fmt.eur(gebundenesKapital(lager)))}
            </span>
          </div>
          <p className="mt-0.5 mb-4 text-sm text-[var(--fg-muted)]">
            {worte.einkauf.ladenhueterHinweis(LIEGETAGE)}
          </p>
          <Datentabelle
            zeilen={lager}
            spalten={lagerSpalten}
            zeilenSchluessel={(z) => z.artnr}
            vorsortierung={{ spalte: "wert", richtung: "ab" }}
            beschriftung={worte.einkauf.ladenhueter}
          />
        </Card>
      )}
    </div>
  );
}
