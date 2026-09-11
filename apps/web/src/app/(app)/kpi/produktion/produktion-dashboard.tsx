"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
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
import { produktionApi } from "@/lib/kpi/produktion";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Badge, Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { useVergleich } from "@/lib/kpi/use-vergleich";



function datum(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("de-DE") : "—";
}

export function ProduktionDashboard() {
  const worte = useTexte();
  const fmt = useFormate();
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);

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

  const zeilenDaten = liste.data;
  const zeilen = useMemo(() => zeilenDaten ?? [], [zeilenDaten]);
  const offene = zeilen.filter((z) => z.art === "offen").length;

  const keineDaten = !verzug.isLoading && verzug.data?.gesamt === 0;
  const fehler = verzug.error ?? verlauf.error ?? liste.error ?? ziele.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/kpi"
            className="inline-flex items-center gap-1 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <ArrowLeft className="h-4 w-4" /> {worte.pfad.seiten["/kpi"]}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{worte.pfad.seiten["/kpi/produktion"]}</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {worte.produktion.einleitung}
          </p>
          <Datenstand bereich="produktion" />
        </div>
        <Zeitraumwahl wahl={wahl} />
      </div>

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
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.produktion.inVerzug}
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={fmt.zahl(verzug.data?.in_verzug)}
          hinweis={offene > 0 ? `davon ${offene} offen und überfällig` : undefined}
          laedt={verzug.isLoading}
          vergleich={
            <Vergleiche
              aktuell={verzug.data?.in_verzug}
              vorperiode={vgl.vorperiode?.in_verzug}
              vorjahr={vgl.vorjahr?.in_verzug}
              vorperiodeLabel={vgl.label}
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
          <h2 className="font-medium">{worte.produktion.verlauf}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.produktion.verlaufHinweis}
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              {/* Rechter Rand trägt die Beschriftung der Ziellinie. */}
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
                      `Verzug (${gesamt} Aufträge)`,
                    ] as [string, string];
                  }}
                />
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

      {zeilen.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.produktion.liste}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.produktion.listeHinweis}
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>{worte.produktion.auftrag}</Th>
                  <Th>{worte.produktion.kunde}</Th>
                  <Th>{worte.produktion.stand}</Th>
                  <Th className="text-right">{worte.produktion.zieltermin}</Th>
                  <Th className="text-right">{worte.produktion.geliefert}</Th>
                  <Th className="text-right">{worte.produktion.verzug}</Th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.vorgang_nr}>
                    <Td className="font-mono text-xs">{z.vorgang_nr}</Td>
                    <Td>{z.customer_name ?? "—"}</Td>
                    <Td>
                      <Badge variant={z.art === "offen" ? "secondary" : undefined}>
                        {worte.produktion[z.art]}
                      </Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{datum(z.ziel)}</Td>
                    <Td className="text-right tabular-nums">{datum(z.ist)}</Td>
                    <Td className="text-right tabular-nums text-[var(--danger)]">
                      +{z.verzug_tage.toLocaleString("de-DE")} d
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
