"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
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
} from "@/lib/kpi/einkauf";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { Seitenkopf } from "@/components/seitenkopf";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { cn } from "@/lib/cn";



function datum(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("de-DE") : "—";
}

export function EinkaufDashboard() {
  const worte = useTexte();
  const fmt = useFormate();
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);

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
    queryFn: () => ladenhueterApi.top(),
  });
  const ziel = nachSchluessel(ziele.data ?? [])["einkauf_otd"];

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      (verlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        // Recharts unterbricht die Linie bei null — genau das ist gewollt:
        // ein Bucket ohne Positionen hat keine Quote, keine gerade Linie.
        quote: p.quote == null ? null : Number(p.quote) * 100,
        gesamt: p.gesamt,
      })),
    [verlaufDaten, t, fmt],
  );

  const zeilenDaten = positionen.data;
  const zeilen = useMemo(() => zeilenDaten ?? [], [zeilenDaten]);
  const lagerDaten = ladenhueter.data;
  const lager = useMemo(() => lagerDaten ?? [], [lagerDaten]);

  const keineDaten = !otd.isLoading && otd.data?.gesamt === 0;
  const fehler = otd.error ?? verlauf.error ?? positionen.error ?? ziele.error ?? ladenhueter.error;

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.einkauf.einleitung}
        bedienung={<Zeitraumwahl wahl={wahl} datenstand={<Datenstand bereich="einkauf" />} />}
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
          <h2 className="font-medium">{worte.einkauf.verlauf}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.einkauf.verlaufHinweis}
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              {/* Rechter Rand traegt die Beschriftung der Ziellinie. */}
              <LineChart data={chartDaten} margin={{ top: 8, right: 56, bottom: 0, left: 8 }}>
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
                      zahl == null ? "—" : `${zahl.toFixed(1)} %`,
                      `OTD (${gesamt} Positionen)`,
                    ] as [string, string];
                  }}
                />
                {ziel != null && (
                <ReferenceLine
                  y={ziel * 100}
                  stroke="var(--fg-muted)"
                  strokeDasharray="4 4"
                  label={{ value: "Ziel", position: "right", fontSize: 11, fill: "var(--fg-muted)" }}
                />
                )}
                <Line
                  type="monotone"
                  dataKey="quote"
                  stroke="var(--accent, #2f6f8f)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.einkauf.ladenhueterHinweis(LIEGETAGE)}
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>{worte.einkauf.artikel}</Th>
                  <Th>{worte.einkauf.bezeichnung}</Th>
                  <Th className="text-end">{worte.einkauf.bestand}</Th>
                  <Th className="text-end">{worte.einkauf.liegtSeit}</Th>
                  <Th className="text-end">{worte.einkauf.stueckpreis}</Th>
                  <Th className="text-end">{worte.einkauf.wert}</Th>
                </tr>
              </thead>
              <tbody>
                {lager.map((z) => (
                  <tr key={z.artnr}>
                    <Td className="font-mono text-xs">{z.artnr}</Td>
                    <Td className="max-w-sm truncate">{z.article_name ?? "—"}</Td>
                    <Td className="text-end tabular-nums">{fmt.zahl(z.bestand)}</Td>
                    <Td className="text-end tabular-nums">{fmt.zahl(z.tage_liegend)} d</Td>
                    <Td className="text-end tabular-nums">{fmt.eurGenau(z.stueckpreis)}</Td>
                    <Td className="text-end tabular-nums">{fmt.eur(z.wert)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {zeilen.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.einkauf.positionen}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.einkauf.positionenHinweis}
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>{worte.einkauf.auftrag}</Th>
                  <Th>{worte.einkauf.lieferant}</Th>
                  <Th>{worte.einkauf.artikel}</Th>
                  <Th className="text-end">{worte.einkauf.zieltermin}</Th>
                  <Th className="text-end">{worte.einkauf.geliefert}</Th>
                  <Th className="text-end">{worte.einkauf.verzug}</Th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={`${z.auftrag}-${z.pos}-${z.upos}`}>
                    <Td className="font-mono text-xs">
                      {z.auftrag}/{z.pos}
                      {z.upos ? `/${z.upos}` : ""}
                    </Td>
                    <Td>{z.supplier_name ?? "—"}</Td>
                    <Td>{z.article_name ?? z.article_number ?? "—"}</Td>
                    <Td className="text-end tabular-nums">{datum(z.target_date)}</Td>
                    <Td className="text-end tabular-nums">{datum(z.delivered_date)}</Td>
                    <Td
                      className={cn(
                        "text-end tabular-nums",
                        z.verzug_tage != null && z.verzug_tage > 0 && "text-[var(--danger)]",
                      )}
                    >
                      {verzugText(z.verzug_tage)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
