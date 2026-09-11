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
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { cn } from "@/lib/cn";



function datum(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("de-DE") : "—";
}

export function EinkaufDashboard() {
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
        label: bucketLabel(p.bucket, t),
        // Recharts unterbricht die Linie bei null — genau das ist gewollt:
        // ein Bucket ohne Positionen hat keine Quote, keine gerade Linie.
        quote: p.quote == null ? null : Number(p.quote) * 100,
        gesamt: p.gesamt,
      })),
    [verlaufDaten, t],
  );

  const zeilenDaten = positionen.data;
  const zeilen = useMemo(() => zeilenDaten ?? [], [zeilenDaten]);
  const lagerDaten = ladenhueter.data;
  const lager = useMemo(() => lagerDaten ?? [], [lagerDaten]);

  const keineDaten = !otd.isLoading && otd.data?.gesamt === 0;
  const fehler = otd.error ?? verlauf.error ?? positionen.error ?? ziele.error ?? ladenhueter.error;

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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Einkauf</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Liefertermintreue der Lieferanten. Gezählt wird, was im Zeitraum angekommen ist.
          </p>
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
          <p className="font-medium">Für diesen Zeitraum liegen keine Lieferpositionen vor</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            Lade den Liefertreue-Export unter{" "}
            <Link href="/uploads" className="underline underline-offset-4">
              Uploads
            </Link>{" "}
            hoch.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kennzahl
          titel="OTD-Quote"
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={fmt.prozent(otd.data?.quote == null ? null : Number(otd.data.quote))}
          hinweis={`Ziel ${fmt.prozent(ziel)} · pünktlich heißt Verzug ≤ 0`}
          laedt={otd.isLoading}
          vergleich={
            <Vergleiche
              aktuell={otd.data?.quote == null ? null : Number(otd.data.quote)}
              vorperiode={vgl.vorperiode?.quote == null ? null : Number(vgl.vorperiode.quote)}
              vorjahr={vgl.vorjahr?.quote == null ? null : Number(vgl.vorjahr.quote)}
              vorperiodeLabel={vgl.label}
            />
          }
        />
        <Kennzahl
          titel="Pünktliche Positionen"
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={fmt.zahl(otd.data?.puenktlich)}
          laedt={otd.isLoading}
        />
        <Kennzahl
          titel="Positionen gesamt"
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={fmt.zahl(otd.data?.gesamt)}
          laedt={otd.isLoading}
        />
        <Kennzahl
          titel="Ø Verzug"
          erklaerung={{ seite: "einkauf", abschnitt: "Liefertermintreue" }}
          wert={verzugText(otd.data?.verzug_schnitt == null ? null : Number(otd.data.verzug_schnitt))}
          hinweis="Positionen ohne Verzugswert zählen hier nicht mit"
          laedt={otd.isLoading}
          vergleich={
            <Vergleiche
              aktuell={otd.data?.verzug_schnitt == null ? null : Number(otd.data.verzug_schnitt)}
              vorperiode={
                vgl.vorperiode?.verzug_schnitt == null ? null : Number(vgl.vorperiode.verzug_schnitt)
              }
              vorjahr={vgl.vorjahr?.verzug_schnitt == null ? null : Number(vgl.vorjahr.verzug_schnitt)}
              vorperiodeLabel={vgl.label}
              richtung="weniger_ist_besser"
            />
          }
        />
      </div>

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">OTD-Quote im Zeitverlauf</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Lücken sind Zeiträume ohne Lieferpositionen.
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
            <h2 className="font-medium">Bestellung auf Lager — Ladenhüter</h2>
            <span className="text-sm text-[var(--fg-muted)]">
              Gebundenes Kapital: {fmt.eur(gebundenesKapital(lager))}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Lagerartikel ohne Bewegung seit mindestens {LIEGETAGE} Tagen, höchster Wert zuerst.
            Stichtag ist heute — der Zeitraum oben gilt hier nicht, weil ein Bestand kein
            Zeitraum ist.
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>Artikel</Th>
                  <Th>Bezeichnung</Th>
                  <Th className="text-right">Bestand</Th>
                  <Th className="text-right">Liegt seit</Th>
                  <Th className="text-right">Stückpreis</Th>
                  <Th className="text-right">Wert</Th>
                </tr>
              </thead>
              <tbody>
                {lager.map((z) => (
                  <tr key={z.artnr}>
                    <Td className="font-mono text-xs">{z.artnr}</Td>
                    <Td className="max-w-sm truncate">{z.article_name ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{fmt.zahl(z.bestand)}</Td>
                    <Td className="text-right tabular-nums">{fmt.zahl(z.tage_liegend)} d</Td>
                    <Td className="text-right tabular-nums">{fmt.eurGenau(z.stueckpreis)}</Td>
                    <Td className="text-right tabular-nums">{fmt.eur(z.wert)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {zeilen.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">Lieferpositionen</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Größter Verzug zuerst, Positionen ohne Verzugswert ganz oben. Höchstens 500 Zeilen.
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>Auftrag</Th>
                  <Th>Lieferant</Th>
                  <Th>Artikel</Th>
                  <Th className="text-right">Zieltermin</Th>
                  <Th className="text-right">Geliefert</Th>
                  <Th className="text-right">Verzug</Th>
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
                    <Td className="text-right tabular-nums">{datum(z.target_date)}</Td>
                    <Td className="text-right tabular-nums">{datum(z.delivered_date)}</Td>
                    <Td
                      className={cn(
                        "text-right tabular-nums",
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
