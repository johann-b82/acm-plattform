"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fenster,
  takt,
  type Zeitraum,
} from "@/lib/kpi/gemeinsam";
import { personalApi, personalKeys } from "@/lib/kpi/personal";
import { ladeZielwerte, nachSchluessel, verfehlt, zielwerteKeys } from "@/lib/zielwerte";
import { Card } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { SPRACHE_TAG } from "@/lib/sprache";
import { STUFEN_MIT_FENSTER, Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { Belegschaft } from "./belegschaft";
import { Mitarbeitertabelle } from "./mitarbeitertabelle";
import { Wochenbericht } from "./wochenbericht";
import { cn } from "@/lib/cn";


/** Ohne Zeitraum wäre der Nenner der Quoten unbestimmt — „Alles" gibt es hier
 *  nicht. Die Sollstunden brauchen ein Fenster. */
function personalFenster(zeitraum: Zeitraum): { von: string; bis: string } {
  const { von, bis } = fenster(zeitraum);
  return { von: von!, bis: bis! };
}


function Abgleichzeile({ darfAbgleichen }: { darfAbgleichen: boolean }) {
  const worte = useTexte();
  const fmt = useFormate();
  const tag = SPRACHE_TAG[useSprache()];
  const qc = useQueryClient();
  const stand = useQuery({
    queryKey: personalKeys.abgleich(),
    queryFn: personalApi.abgleichstand,
  });
  const anstossen = useMutation({
    mutationFn: personalApi.abgleichAnstossen,
    onSuccess: () => qc.invalidateQueries({ queryKey: personalKeys.alle() }),
  });

  const s = stand.data;
  const zeitpunkt = s
    ? new Date(s.gelaufen_am).toLocaleString(tag, {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="text-sm">
        {stand.isLoading && <span className="text-[var(--fg-muted)]">{worte.personal.standLaedt}</span>}
        {!stand.isLoading && !s && (
          <span className="text-[var(--fg-muted)]">
            {worte.personal.keinAbgleich}
          </span>
        )}
        {s && (
          <span className={cn(s.status === "fehler" && "text-[var(--danger)]")}>
            {worte.personal.letzterAbgleich(zeitpunkt ?? "—", s.status)} ·{" "}
            <span className="text-[var(--fg-muted)] tabular-nums">
              {worte.personal.bestand(
                fmt.zahl(s.mitarbeiter),
                fmt.zahl(s.anwesenheiten),
                fmt.zahl(s.abwesenheiten),
              )}
            </span>
            {s.fehler && (
              <span className="mt-1 block text-xs text-[var(--danger)]">{s.fehler}</span>
            )}
          </span>
        )}
      </div>
      {darfAbgleichen && (
        <button
          type="button"
          onClick={() => anstossen.mutate()}
          disabled={anstossen.isPending}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm",
            "hover:bg-[var(--muted)] disabled:opacity-50",
          )}
        >
          <RefreshCw className={cn("h-4 w-4", anstossen.isPending && "animate-spin")} />
          {anstossen.isPending ? worte.personal.abgleichLaeuft : worte.personal.abgleichen}
        </button>
      )}
      {anstossen.error && (
        <p className="w-full text-sm text-[var(--danger)]">
          {(anstossen.error as Error).message}
        </p>
      )}
    </Card>
  );
}

export function PersonalDashboard({ darfAbgleichen }: { darfAbgleichen: boolean }) {
  const worte = useTexte();
  const fmt = useFormate();
  const wahl = useZeitraumwahl();
  const { zeitraum } = wahl;
  // Ohne Fenster wäre der Nenner der Quoten unbestimmt; „Alles" steht deshalb
  // nicht zur Wahl, und ein leeres Fenster fällt auf das laufende Jahr zurück.
  const { von, bis } = useMemo(
    () => (wahl.von && wahl.bis ? { von: wahl.von, bis: wahl.bis } : personalFenster("jahr")),
    [wahl.von, wahl.bis],
  );
  const t = takt(von, bis);

  const ueber = useQuery({
    queryKey: [...personalKeys.fenster(von, bis), "ueberstunden"],
    queryFn: () => personalApi.ueberstunden(von, bis),
  });
  const krank = useQuery({
    queryKey: [...personalKeys.fenster(von, bis), "krankheit"],
    queryFn: () => personalApi.krankheit(von, bis),
  });
  const fluk = useQuery({
    queryKey: [...personalKeys.fenster(von, bis), "fluktuation"],
    queryFn: () => personalApi.fluktuation(von, bis),
  });
  const vglUeber = useVergleich(
    ["hr", "ueberstunden"],
    zeitraum,
    von,
    bis,
    personalApi.ueberstunden,
  );
  const vglKrank = useVergleich(["hr", "krankheit"], zeitraum, von, bis, personalApi.krankheit);
  const vglFluk = useVergleich(["hr", "fluktuation"], zeitraum, von, bis, personalApi.fluktuation);

  const verlauf = useQuery({
    queryKey: [...personalKeys.fenster(von, bis), "verlauf"],
    queryFn: () => personalApi.verlauf(von, bis),
  });
  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const ziel = nachSchluessel(ziele.data ?? []);

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      (verlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        ueberstunden: p.ueberstunden_quote == null ? null : p.ueberstunden_quote * 100,
        krankheit: p.krankheits_quote == null ? null : p.krankheits_quote * 100,
      })),
    [verlaufDaten, t, fmt],
  );

  const laedt = ueber.isLoading || krank.isLoading || fluk.isLoading;
  const keineDaten = !ueber.isLoading && ueber.data?.ist_stunden === 0 && ueber.data?.personen === 0;
  const fehler = ueber.error ?? krank.error ?? fluk.error ?? verlauf.error ?? ziele.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <ArrowLeft className="h-4 w-4" /> {worte.personal.uebersicht}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{worte.pfad.seiten["/hr"]}</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.personal.einleitung}
          </p>
          <div className="mt-2 flex gap-4 text-sm">
            <Link href="/hr/organigramm" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/organigramm"]}
            </Link>
            <Link href="/hr/kompetenzen" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/kompetenzen"]}
            </Link>
            <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/schulungen"]}
            </Link>
            <Link href="/hr/onboarding" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/onboarding"]}
            </Link>
            <Link href="/hr/einarbeitung" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/einarbeitung"]}
            </Link>
          </div>
        </div>
        <Zeitraumwahl wahl={wahl} stufen={STUFEN_MIT_FENSTER} />
      </div>

      <Abgleichzeile darfAbgleichen={darfAbgleichen} />

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {worte.dashboard.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      {keineDaten && (
        <Card className="p-8 text-center">
          <p className="font-medium">{worte.personal.keineDaten}</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.personal.keineDatenHinweis}
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kennzahl
          titel={worte.personal.ueberstunden}
          erklaerung={{ seite: "personal", abschnitt: "Die Quoten" }}
          wert={fmt.prozent(ueber.data?.quote)}
          hinweis={
            ueber.data
              ? worte.personal.stundenVon(
                  fmt.zahl(Math.round(ueber.data.ueberstunden)),
                  fmt.zahl(Math.round(ueber.data.ist_stunden)),
                )
              : undefined
          }
          warnung={verfehlt(ueber.data?.quote ?? null, ziel["hr_ueberstunden"], "max")}
          vergleich={
            <Vergleiche
              aktuell={ueber.data?.quote}
              vorperiode={vglUeber.vorperiode?.quote}
              vorjahr={vglUeber.vorjahr?.quote}
              vorperiodeLabel={vglUeber.label}
              richtung="weniger_ist_besser"
            />
          }
          laedt={laedt}
        />
        <Kennzahl
          titel={worte.personal.krankheit}
          erklaerung={{ seite: "personal", abschnitt: "Die Quoten" }}
          wert={krank.data?.eingerichtet === false ? "—" : fmt.prozent(krank.data?.quote)}
          hinweis={
            krank.data?.eingerichtet === false
              ? worte.personal.krankheitsartenFehlen
              : krank.data
                ? worte.personal.stundenVon(
                    fmt.zahl(Math.round(krank.data.krank_stunden)),
                    fmt.zahl(Math.round(krank.data.soll_stunden)),
                  )
                : undefined
          }
          warnung={verfehlt(krank.data?.quote ?? null, ziel["hr_krankheit"], "max")}
          laedt={laedt}
          vergleich={
            <Vergleiche
              aktuell={krank.data?.quote}
              vorperiode={vglKrank.vorperiode?.quote}
              vorjahr={vglKrank.vorjahr?.quote}
              vorperiodeLabel={vglKrank.label}
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.personal.fluktuation}
          erklaerung={{ seite: "personal", abschnitt: "Die Quoten" }}
          wert={fmt.prozent(fluk.data?.quote)}
          hinweis={
            fluk.data
              ? worte.personal.fluktuationHinweis(
                  fmt.zahl(fluk.data.austritte),
                  fluk.data.bestand_schnitt.toFixed(1),
                )
              : undefined
          }
          warnung={verfehlt(fluk.data?.quote ?? null, ziel["hr_fluktuation"], "max")}
          vergleich={
            <Vergleiche
              aktuell={fluk.data?.quote}
              vorperiode={vglFluk.vorperiode?.quote}
              vorjahr={vglFluk.vorjahr?.quote}
              vorperiodeLabel={vglFluk.label}
              richtung="weniger_ist_besser"
            />
          }
          laedt={laedt}
        />
        <Kennzahl
          titel={worte.personal.personen}
          erklaerung={{ seite: "personal", abschnitt: "Die Quoten" }}
          wert={fmt.zahl(ueber.data?.personen)}
          hinweis={worte.personal.personenHinweis}
          laedt={laedt}
        />
      </div>

      {krank.data?.eingerichtet === false && (
        <Card className="flex items-start gap-3 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fg-muted)]" />
          <p>
            {worte.personal.krankheitHinweisVor}
            <Link href="/einstellungen" className="underline underline-offset-4">
              {worte.pfad.seiten["/einstellungen"]}
            </Link>
            {worte.personal.krankheitHinweisNach}
          </p>
        </Card>
      )}

      <Belegschaft />

      <Mitarbeitertabelle von={von} bis={bis} />

      {darfAbgleichen && <Wochenbericht />}

      <Card className="p-4">
        <h2 className="text-base font-semibold">{worte.personal.verlauf}</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {t === "day"
            ? worte.dashboard.jeTag
            : t === "week"
              ? worte.dashboard.jeWoche
              : worte.dashboard.jeMonat}
        </p>
        <div className="mt-4 h-72">
          {chartDaten.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--fg-muted)]">
              {verlauf.isLoading ? "wird geladen …" : "keine Werte im Zeitraum"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartDaten} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
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
                  width={56}
                  tickFormatter={(v: number) => `${v} %`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--fg)",
                  }}
                  formatter={(wert, name) =>
                    [
                      wert == null ? "—" : `${Number(wert).toFixed(2)} %`,
                      name === "ueberstunden"
                        ? worte.personal.reiheUeberstunden
                        : worte.personal.reiheKrankheit,
                    ] as [string, string]
                  }
                />
                <Legend
                  formatter={(name) =>
                    name === "ueberstunden"
                      ? worte.personal.reiheUeberstunden
                      : worte.personal.reiheKrankheit
                  }
                  wrapperStyle={{ fontSize: 12 }}
                />
                {ziel["hr_ueberstunden"] != null && (
                  <ReferenceLine
                    y={ziel["hr_ueberstunden"] * 100}
                    stroke="var(--fg-muted)"
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="ueberstunden"
                  stroke="var(--ring)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="krankheit"
                  stroke="var(--danger)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
