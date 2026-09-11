"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import { vertriebApi } from "@/lib/kpi/vertrieb";
import { Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { AktivitaetKarte } from "./aktivitaet-karte";



export function VertriebDashboard() {
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);

  const summe = useQuery({
    queryKey: ["kpi", "vertrieb", "summe", von, bis],
    queryFn: () => vertriebApi.summe(von, bis),
  });

  const vgl = useVergleich(
    ["kpi", "vertrieb", "summe"],
    zeitraum,
    von,
    bis,
    vertriebApi.summe,
  );
  const verlauf = useQuery({
    queryKey: ["kpi", "vertrieb", "verlauf", von, bis],
    queryFn: () => vertriebApi.verlauf(von, bis),
  });
  const kunden = useQuery({
    queryKey: ["kpi", "vertrieb", "kunden", von, bis],
    queryFn: () => vertriebApi.kundenanteil("revenues", von, bis, 10),
  });
  const erfasser = useQuery({
    queryKey: ["kpi", "vertrieb", "erfasser", von, bis],
    queryFn: () => vertriebApi.jeErfasser(von, bis),
  });

  const chartDaten = (verlauf.data ?? []).map((p) => ({
    label: bucketLabel(p.bucket, t),
    umsatz: Number(p.umsatz),
  }));

  const keineDaten =
    !summe.isLoading && summe.data?.umsatz_zeilen === 0 && summe.data?.auftraege_anzahl === 0;

  const fehler = summe.error ?? verlauf.error ?? kunden.error ?? erfasser.error;

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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Vertrieb</h1>
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
          <p className="font-medium">Für diesen Zeitraum liegen keine Daten vor</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            Lade die ERP-Exporte unter{" "}
            <Link href="/uploads" className="underline underline-offset-4">
              Uploads
            </Link>{" "}
            hoch, oder wähle einen größeren Zeitraum.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kennzahl
          titel="Umsatz"
          erklaerung={{ seite: "vertrieb", abschnitt: "Die Kacheln" }}
          wert={fmt.eur(summe.data?.umsatz)}
          hinweis="Rechnungen abzüglich Gutschriften"
          laedt={summe.isLoading}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.umsatz}
              vorperiode={vgl.vorperiode?.umsatz}
              vorjahr={vgl.vorjahr?.umsatz}
              vorperiodeLabel={vgl.label}
            />
          }
        />
        <Kennzahl
          titel="Ø Auftragswert"
          erklaerung={{ seite: "vertrieb", abschnitt: "Die Kacheln" }}
          wert={fmt.eur(summe.data?.auftragswert_avg)}
          hinweis="Aufträge über 0 €"
          laedt={summe.isLoading}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.auftragswert_avg}
              vorperiode={vgl.vorperiode?.auftragswert_avg}
              vorjahr={vgl.vorjahr?.auftragswert_avg}
              vorperiodeLabel={vgl.label}
            />
          }
        />
        <Kennzahl
          titel="Aufträge gesamt"
          erklaerung={{ seite: "vertrieb", abschnitt: "Die Kacheln" }}
          wert={fmt.zahl(summe.data?.auftraege_anzahl)}
          hinweis="Aufträge über 0 €"
          laedt={summe.isLoading}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.auftraege_anzahl}
              vorperiode={vgl.vorperiode?.auftraege_anzahl}
              vorjahr={vgl.vorjahr?.auftraege_anzahl}
              vorperiodeLabel={vgl.label}
            />
          }
        />
      </div>

      <Card className="p-4">
        <h2 className="text-base font-semibold">Umsatzverlauf</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {t === "day" ? "je Tag" : t === "week" ? "je Woche" : "je Monat"}, Gutschriften abgezogen
        </p>
        <div className="mt-4 h-72">
          {chartDaten.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--fg-muted)]">
              {verlauf.isLoading ? "wird geladen …" : "keine Werte im Zeitraum"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDaten} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="var(--fg-muted)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  stroke="var(--fg-muted)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(v: number) => fmt.eur(v)}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--fg)",
                  }}
                  formatter={(v) => [fmt.eurGenau(Number(v)), "Umsatz"] as [string, string]}
                />
                {/* Ohne Animation: die Abfragen lösen zu unterschiedlichen Zeiten
                    aus, das Neurendern lässt die Einblendung hängen und die Balken
                    bleiben gestaucht stehen. Ein Dashboard braucht sie auch nicht. */}
                <Bar
                  dataKey="umsatz"
                  fill="var(--ring)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={64}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <AktivitaetKarte von={von} bis={bis} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-base font-semibold">Kundenanteil am Umsatz</h2>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Kunde</Th>
                  <Th className="text-right">Umsatz</Th>
                  <Th className="text-right">Anteil</Th>
                </tr>
              </thead>
              <tbody>
                {(kunden.data ?? []).map((k) => (
                  <tr key={k.kunde}>
                    <Td className={k.kunde === "Übrige" ? "text-[var(--fg-muted)]" : ""}>{k.kunde}</Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.eur(Number(k.wert))}</Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.prozent(Number(k.anteil))}</Td>
                  </tr>
                ))}
                {kunden.data?.length === 0 && (
                  <tr>
                    <Td colSpan={3} className="text-[var(--fg-muted)]">
                      keine Werte im Zeitraum
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableWrap>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold">Aufträge je Erfasser</h2>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Erfasser</Th>
                  <Th className="text-right">Aufträge</Th>
                  <Th className="text-right">Summe</Th>
                </tr>
              </thead>
              <tbody>
                {(erfasser.data ?? []).map((e) => (
                  <tr key={e.erfasser}>
                    <Td>{e.erfasser}</Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.zahl(e.auftraege_anzahl)}</Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.eur(Number(e.wert_summe))}</Td>
                  </tr>
                ))}
                {erfasser.data?.length === 0 && (
                  <tr>
                    <Td colSpan={3} className="text-[var(--fg-muted)]">
                      keine Werte im Zeitraum
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      </div>
    </div>
  );
}
