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
  takt,
} from "@/lib/kpi/gemeinsam";
import { vertriebApi } from "@/lib/kpi/vertrieb";
import { Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { AktivitaetKarte } from "./aktivitaet-karte";



export function VertriebDashboard() {
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const worte = useTexte();
  const fmt = useFormate();
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
    label: fmt.bucket(p.bucket, t),
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
            <ArrowLeft className="h-4 w-4" /> {worte.pfad.seiten["/kpi"]}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{worte.pfad.seiten["/kpi/vertrieb"]}</h1>
          <Datenstand bereich="vertrieb" />
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
          <p className="font-medium">{worte.dashboard.keineDatenTitel}</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.dashboard.keineDatenVor}
            <Link href="/uploads" className="underline underline-offset-4">
              {worte.pfad.seiten["/uploads"]}
            </Link>
            {worte.dashboard.keineDatenNach}
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kennzahl
          titel={worte.vertrieb.umsatz}
          erklaerung={{ seite: "vertrieb", abschnitt: "Die Kacheln" }}
          wert={fmt.eur(summe.data?.umsatz)}
          hinweis={worte.vertrieb.umsatzHinweis}
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
          titel={worte.vertrieb.auftragswert}
          erklaerung={{ seite: "vertrieb", abschnitt: "Die Kacheln" }}
          wert={fmt.eur(summe.data?.auftragswert_avg)}
          hinweis={worte.vertrieb.ueberNull}
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
          titel={worte.vertrieb.auftraege}
          erklaerung={{ seite: "vertrieb", abschnitt: "Die Kacheln" }}
          wert={fmt.zahl(summe.data?.auftraege_anzahl)}
          hinweis={worte.vertrieb.ueberNull}
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
        <h2 className="text-base font-semibold">{worte.vertrieb.verlauf}</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {worte.vertrieb.verlaufHinweis(
            t === "day"
              ? worte.dashboard.jeTag
              : t === "week"
                ? worte.dashboard.jeWoche
                : worte.dashboard.jeMonat,
          )}
        </p>
        <div className="mt-4 h-72">
          {chartDaten.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--fg-muted)]">
              {verlauf.isLoading ? worte.dashboard.laedt : worte.dashboard.keineWerte}
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
                  formatter={(v) => [fmt.eurGenau(Number(v)), worte.vertrieb.umsatz] as [string, string]}
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
          <h2 className="mb-2 text-base font-semibold">{worte.vertrieb.kundenanteil}</h2>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{worte.vertrieb.kunde}</Th>
                  <Th className="text-right">{worte.vertrieb.umsatz}</Th>
                  <Th className="text-right">{worte.vertrieb.anteil}</Th>
                </tr>
              </thead>
              <tbody>
                {(kunden.data ?? []).map((k) => (
                  <tr key={k.kunde}>
                    <Td className={k.kunde === "Übrige" ? "text-[var(--fg-muted)]" : ""}>
                      {k.kunde === "Übrige" ? worte.vertrieb.uebrige : k.kunde}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.eur(Number(k.wert))}</Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.prozent(Number(k.anteil))}</Td>
                  </tr>
                ))}
                {kunden.data?.length === 0 && (
                  <tr>
                    <Td colSpan={3} className="text-[var(--fg-muted)]">
                      {worte.dashboard.keineWerte}
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableWrap>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold">{worte.vertrieb.jeErfasser}</h2>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{worte.vertrieb.erfasser}</Th>
                  <Th className="text-right">{worte.vertrieb.anzahl}</Th>
                  <Th className="text-right">{worte.vertrieb.summe}</Th>
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
                      {worte.dashboard.keineWerte}
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
