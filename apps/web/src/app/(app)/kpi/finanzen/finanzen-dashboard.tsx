"use client";

import { useMemo, useState } from "react";
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
  ZEITRAUM_LABEL,
  bucketLabel,
  fenster,
  fmt,
  takt,
  type Zeitraum,
} from "@/lib/kpi/gemeinsam";
import { finanzenApi } from "@/lib/kpi/finanzen";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const ZEITRAEUME: Zeitraum[] = ["monat", "quartal", "jahr", "alles"];

function Kachel({
  titel,
  wert,
  hinweis,
  warnung,
  laedt,
}: {
  titel: string;
  wert: string;
  hinweis?: string;
  warnung?: boolean;
  laedt: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-sm text-[var(--fg-muted)]">{titel}</div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl font-medium tabular-nums",
          warnung && "text-[var(--danger)]",
        )}
      >
        {laedt ? <span className="text-[var(--fg-muted)]">…</span> : wert}
      </div>
      {hinweis && <div className="mt-1 text-xs text-[var(--fg-muted)]">{hinweis}</div>}
    </Card>
  );
}

export function FinanzenDashboard() {
  const [zeitraum, setZeitraum] = useState<Zeitraum>("jahr");
  const { von, bis } = useMemo(() => fenster(zeitraum), [zeitraum]);
  const t = takt(von, bis);

  const summe = useQuery({
    queryKey: ["kpi", "finanzen", "material", von, bis],
    queryFn: () => finanzenApi.materialkosten(von, bis),
  });
  const verlauf = useQuery({
    queryKey: ["kpi", "finanzen", "verlauf", von, bis],
    queryFn: () => finanzenApi.verlauf(von, bis),
  });
  const verbrauch = useQuery({
    queryKey: ["kpi", "finanzen", "verbrauch", von, bis],
    queryFn: () => finanzenApi.verbrauch(von, bis),
  });
  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const ziel = nachSchluessel(ziele.data ?? [])["finanzen_materialkostenquote"];

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      (verlaufDaten ?? []).map((p) => ({
        label: bucketLabel(p.bucket, t),
        quote: p.quote == null ? null : p.quote * 100,
        kosten: p.materialkosten,
      })),
    [verlaufDaten, t],
  );

  const zeilenDaten = verbrauch.data;
  const zeilen = useMemo(() => zeilenDaten ?? [], [zeilenDaten]);

  const keineDaten = !summe.isLoading && summe.data?.materialkosten === 0 && summe.data?.umsatz === 0;
  const fehler = summe.error ?? verlauf.error ?? verbrauch.error ?? ziele.error;

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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finanzen</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Materialkosten im Verhältnis zum Umsatz. Die Personalkostenquote folgt mit dem
            HR-Modul.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
          {ZEITRAEUME.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZeitraum(z)}
              aria-pressed={zeitraum === z}
              className={cn(
                "rounded px-3 py-1 text-sm transition-colors",
                zeitraum === z
                  ? "bg-[var(--fg)] text-[var(--bg)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              {ZEITRAUM_LABEL[z]}
            </button>
          ))}
        </div>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Kennzahlen konnten nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      {keineDaten && (
        <Card className="p-8 text-center">
          <p className="font-medium">Für diesen Zeitraum liegen keine Daten vor</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            Es braucht drei Dateien: die Lagerbewegungen für den Verbrauch, die Wareneingänge für
            die Preise und den Umsatz als Bezugsgröße. Alle drei liegen unter{" "}
            <Link href="/uploads" className="underline underline-offset-4">
              Uploads
            </Link>
            .
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kachel
          titel="Materialkostenquote"
          wert={fmt.prozent(summe.data?.quote)}
          hinweis={ziel == null ? "Materialkosten / Umsatz" : `Höchstens ${fmt.prozent(ziel)}`}
          warnung={ziel != null && summe.data?.quote != null && summe.data.quote > ziel}
          laedt={summe.isLoading}
        />
        <Kachel titel="Materialkosten" wert={fmt.eur(summe.data?.materialkosten)} laedt={summe.isLoading} />
        <Kachel titel="Umsatz" wert={fmt.eur(summe.data?.umsatz)} laedt={summe.isLoading} />
        <Kachel
          titel="Artikel ohne Preis"
          wert={fmt.zahl(summe.data?.ohne_preis)}
          hinweis="verbraucht, aber nicht bewertet"
          warnung={(summe.data?.ohne_preis ?? 0) > 0}
          laedt={summe.isLoading}
        />
      </div>

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">Materialkostenquote im Zeitverlauf</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Lücken sind Zeiträume ohne Umsatz — ohne Bezugsgröße gibt es keine Quote.
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              {/* Rechter Rand trägt die Beschriftung der Ziellinie. */}
              <LineChart data={chartDaten} margin={{ top: 8, right: 56, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--fg-muted)" />
                <YAxis
                  tick={{ fontSize: 12 }}
                  stroke="var(--fg-muted)"
                  tickFormatter={(v: number) => `${v} %`}
                  width={56}
                />
                <Tooltip
                  formatter={(wert, _name, eintrag) => {
                    const zahl = typeof wert === "number" ? wert : null;
                    const kosten = (eintrag?.payload as { kosten?: number } | undefined)?.kosten ?? 0;
                    return [
                      zahl == null ? "—" : `${zahl.toFixed(1)} %`,
                      `Quote (${fmt.eur(kosten)} Material)`,
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
          <h2 className="font-medium">Materialverbrauch je Artikel</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Höchste Kosten zuerst. Artikel ohne Preis stehen am Ende — sie gehen in die Quote
            nicht ein. Höchstens 500 Zeilen.
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>Artikel</Th>
                  <Th>Bezeichnung</Th>
                  <Th className="text-right">Verbrauch</Th>
                  <Th className="text-right">Stückpreis</Th>
                  <Th className="text-right">Kosten</Th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.artikelnr}>
                    <Td className="font-mono text-xs">{z.artikelnr}</Td>
                    <Td className="max-w-sm truncate">{z.article_name ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{fmt.zahl(z.menge)}</Td>
                    <Td className="text-right tabular-nums">
                      {z.stueckpreis == null ? (
                        <span className="text-[var(--danger)]">kein Preis</span>
                      ) : (
                        fmt.eurGenau(z.stueckpreis)
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">{fmt.eur(z.kosten)}</Td>
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
