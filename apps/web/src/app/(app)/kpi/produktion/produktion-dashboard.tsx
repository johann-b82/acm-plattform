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
  bucketLabel,
  fmt,
  takt,
} from "@/lib/kpi/gemeinsam";
import { ART_LABEL, produktionApi } from "@/lib/kpi/produktion";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Badge, Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { useVergleich } from "@/lib/kpi/use-vergleich";



function datum(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("de-DE") : "—";
}

export function ProduktionDashboard() {
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
        label: bucketLabel(p.bucket, t),
        quote: p.quote == null ? null : Number(p.quote) * 100,
        gesamt: p.gesamt,
      })),
    [verlaufDaten, t],
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
            <ArrowLeft className="h-4 w-4" /> KPI-Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Produktion</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Aufträge in Verzug. Gezählt wird ein Auftrag erst, wenn sein Ausgang feststeht.
          </p>
          <Datenstand bereich="produktion" />
        </div>
        <Zeitraumwahl wahl={wahl} />
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Kennzahlen konnten nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      {keineDaten && (
        <Card className="p-8 text-center">
          <p className="font-medium">Für diesen Zeitraum liegt kein Auftrag mit feststehendem Ausgang vor</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            Lade die Auftragspositionen und die Lieferscheine unter{" "}
            <Link href="/uploads" className="underline underline-offset-4">
              Uploads
            </Link>{" "}
            hoch. Beide werden gebraucht: die eine Datei trägt den Zieltermin, die andere das
            Ist-Datum.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kennzahl
          titel="Verzugsquote"
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={fmt.prozent(verzug.data?.quote == null ? null : Number(verzug.data.quote))}
          hinweis={`Höchstens ${fmt.prozent(ziel)}`}
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
          titel="Aufträge in Verzug"
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
          titel="Aufträge gesamt"
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={fmt.zahl(verzug.data?.gesamt)}
          hinweis="ohne noch nicht fällige offene Aufträge"
          laedt={verzug.isLoading}
        />
        <Kennzahl
          titel="Ø Verzug"
          erklaerung={{ seite: "produktion", abschnitt: "Aufträge in Verzug" }}
          wert={
            verzug.data?.verzug_schnitt == null
              ? "—"
              : `${Number(verzug.data.verzug_schnitt) > 0 ? "+" : ""}${(
                  Math.round(Number(verzug.data.verzug_schnitt) * 10) / 10
                ).toLocaleString("de-DE")} d`
          }
          hinweis="pünktliche Aufträge gehen negativ ein"
          laedt={verzug.isLoading}
        />
      </div>

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">Verzugsquote im Zeitverlauf</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Nach Zieltermin. Lücken sind Zeiträume ohne gezählte Aufträge.
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

      {zeilen.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">Aufträge in Verzug</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Größter Verzug zuerst. Bei offenen Aufträgen wächst er täglich weiter. Höchstens 500
            Zeilen.
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>Auftrag</Th>
                  <Th>Kunde</Th>
                  <Th>Stand</Th>
                  <Th className="text-right">Zieltermin</Th>
                  <Th className="text-right">Geliefert</Th>
                  <Th className="text-right">Verzug</Th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.vorgang_nr}>
                    <Td className="font-mono text-xs">{z.vorgang_nr}</Td>
                    <Td>{z.customer_name ?? "—"}</Td>
                    <Td>
                      <Badge variant={z.art === "offen" ? "secondary" : undefined}>
                        {ART_LABEL[z.art]}
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
