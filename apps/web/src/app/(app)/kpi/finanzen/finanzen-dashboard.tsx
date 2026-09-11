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
import { finanzenApi } from "@/lib/kpi/finanzen";
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



export function FinanzenDashboard() {
  const worte = useTexte();
  const fmt = useFormate();
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
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
  const vglMaterial = useVergleich(
    ["kpi", "finanzen", "material"],
    zeitraum,
    von,
    bis,
    finanzenApi.materialkosten,
  );
  const vglPersonal = useVergleich(
    ["kpi", "finanzen", "personal"],
    zeitraum,
    von,
    bis,
    finanzenApi.personalkosten,
  );

  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const zielNach = nachSchluessel(ziele.data ?? []);
  const ziel = zielNach["finanzen_materialkostenquote"];
  const zielPersonal = zielNach["finanzen_personalkostenquote"];

  // Die Personalkostenquote verteilt Monatsbrutto anteilig — ohne Fenster
  // ergibt das nichts. Beim Zeitraum „Alles" bleibt sie deshalb aus.
  const hatFenster = von != null && bis != null;
  const personal = useQuery({
    queryKey: ["kpi", "finanzen", "personal", von, bis],
    queryFn: () => finanzenApi.personalkosten(von!, bis!),
    enabled: hatFenster,
  });
  const jeAbteilung = useQuery({
    queryKey: ["kpi", "finanzen", "personal-abteilung", von, bis],
    queryFn: () => finanzenApi.personalkostenJeAbteilung(von!, bis!),
    enabled: hatFenster,
  });

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      (verlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        quote: p.quote == null ? null : p.quote * 100,
        kosten: p.materialkosten,
      })),
    [verlaufDaten, t, fmt],
  );

  const zeilenDaten = verbrauch.data;
  const zeilen = useMemo(() => zeilenDaten ?? [], [zeilenDaten]);

  const keineDaten = !summe.isLoading && summe.data?.materialkosten === 0 && summe.data?.umsatz === 0;
  const fehler =
    summe.error ?? verlauf.error ?? verbrauch.error ?? ziele.error ??
    personal.error ?? jeAbteilung.error;

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.finanzen.einleitung}
        unter={<Datenstand bereich="finanzen" />}
        bedienung={<Zeitraumwahl wahl={wahl} />}
      />

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {worte.dashboard.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      {keineDaten && (
        <Card className="p-8 text-center">
          <p className="font-medium">{worte.dashboard.keineDatenTitel}</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.finanzen.keineDatenVor}
            <Link href="/uploads" className="underline underline-offset-4">
              {worte.pfad.seiten["/uploads"]}
            </Link>
            {worte.finanzen.keineDatenNach}
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kennzahl
          titel={worte.finanzen.materialquote}
          erklaerung={{ seite: "finanzen", abschnitt: "Materialkostenquote" }}
          wert={fmt.prozent(summe.data?.quote)}
          hinweis={
            ziel == null
              ? worte.finanzen.materialquoteHinweis
              : worte.finanzen.hoechstens(fmt.prozent(ziel))
          }
          warnung={ziel != null && summe.data?.quote != null && summe.data.quote > ziel}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.quote}
              vorperiode={vglMaterial.vorperiode?.quote}
              vorjahr={vglMaterial.vorjahr?.quote}
              vorperiodeLabel={vglMaterial.label}
              richtung="weniger_ist_besser"
            />
          }
          laedt={summe.isLoading}
        />
        <Kennzahl
          titel={worte.finanzen.materialkosten}
          erklaerung={{ seite: "finanzen", abschnitt: "Materialkostenquote" }}
          wert={fmt.eur(summe.data?.materialkosten)}
          laedt={summe.isLoading}
        />
        <Kennzahl
          titel={worte.finanzen.umsatz}
          erklaerung={{ seite: "finanzen", abschnitt: "Materialkostenquote" }}
          wert={fmt.eur(summe.data?.umsatz)}
          laedt={summe.isLoading}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.umsatz}
              vorperiode={vglMaterial.vorperiode?.umsatz}
              vorjahr={vglMaterial.vorjahr?.umsatz}
              vorperiodeLabel={vglMaterial.label}
            />
          }
        />
        <Kennzahl
          titel={worte.finanzen.personalquote}
          erklaerung={{ seite: "finanzen", abschnitt: "Personalkostenquote" }}
          wert={hatFenster ? fmt.prozent(personal.data?.quote) : "—"}
          hinweis={
            !hatFenster
              ? worte.finanzen.brauchtZeitraum
              : personal.data
                ? worte.finanzen.personalHinweis(
                    fmt.eur(personal.data.personalkosten),
                    fmt.zahl(personal.data.personen),
                  )
                : undefined
          }
          warnung={
            zielPersonal != null &&
            personal.data?.quote != null &&
            personal.data.quote > zielPersonal
          }
          laedt={personal.isLoading}
          vergleich={
            <Vergleiche
              aktuell={personal.data?.quote}
              vorperiode={vglPersonal.vorperiode?.quote}
              vorjahr={vglPersonal.vorjahr?.quote}
              vorperiodeLabel={vglPersonal.label}
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.finanzen.ohnePreis}
          erklaerung={{ seite: "finanzen", abschnitt: "Wenn eine Quote leer bleibt" }}
          wert={fmt.zahl(summe.data?.ohne_preis)}
          hinweis={worte.finanzen.ohnePreisHinweis}
          warnung={(summe.data?.ohne_preis ?? 0) > 0}
          laedt={summe.isLoading}
        />
      </div>

      {hatFenster && (jeAbteilung.data?.length ?? 0) > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.finanzen.jeAbteilung}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Abteilungen mit weniger als drei beitragenden Personen stehen unter{" "}
            {"„Übrige“"} — eine Abteilung mit einer Person wäre sonst deren Gehalt.
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>{worte.finanzen.abteilung}</Th>
                  <Th className="text-right">{worte.finanzen.personen}</Th>
                  <Th className="text-right">{worte.finanzen.kosten}</Th>
                  <Th className="text-right">{worte.finanzen.anteil}</Th>
                </tr>
              </thead>
              <tbody>
                {(jeAbteilung.data ?? []).map((z) => (
                  <tr key={z.abteilung}>
                    <Td className={z.gebuendelt ? "text-[var(--fg-muted)]" : ""}>
                      {z.abteilung}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.zahl(z.personen)}</Td>
                    <Td className="text-right font-mono tabular-nums">{fmt.eur(z.kosten)}</Td>
                    <Td className="text-right font-mono tabular-nums">
                      {personal.data && personal.data.personalkosten > 0
                        ? fmt.prozent(z.kosten / personal.data.personalkosten)
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.finanzen.verlauf}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.finanzen.verlaufHinweis}
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
                    label={{
                      value: worte.finanzen.ziellinie,
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
          <h2 className="font-medium">{worte.finanzen.verbrauch}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.finanzen.verbrauchHinweis}
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>{worte.finanzen.artikel}</Th>
                  <Th>{worte.finanzen.bezeichnung}</Th>
                  <Th className="text-right">{worte.finanzen.menge}</Th>
                  <Th className="text-right">{worte.finanzen.stueckpreis}</Th>
                  <Th className="text-right">{worte.finanzen.kosten}</Th>
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
                        <span className="text-[var(--danger)]">{worte.finanzen.keinPreis}</span>
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
