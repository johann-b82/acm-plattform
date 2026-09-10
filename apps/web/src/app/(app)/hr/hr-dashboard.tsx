"use client";

import { useMemo, useState } from "react";
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
  ZEITRAUM_LABEL,
  bucketLabel,
  fenster,
  fmt,
  takt,
  type Zeitraum,
} from "@/lib/kpi/gemeinsam";
import { personalApi, personalKeys } from "@/lib/kpi/personal";
import { ladeZielwerte, nachSchluessel, verfehlt, zielwerteKeys } from "@/lib/zielwerte";
import { Card } from "@/components/ui/primitives";
import { Belegschaft } from "./belegschaft";
import { Mitarbeitertabelle } from "./mitarbeitertabelle";
import { Wochenbericht } from "./wochenbericht";
import { cn } from "@/lib/cn";

const ZEITRAEUME: Zeitraum[] = ["monat", "quartal", "jahr"];

/** Ohne Zeitraum wäre der Nenner der Quoten unbestimmt — „Alles" gibt es hier
 *  nicht. Die Sollstunden brauchen ein Fenster. */
function personalFenster(zeitraum: Zeitraum): { von: string; bis: string } {
  const { von, bis } = fenster(zeitraum);
  return { von: von!, bis: bis! };
}

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

function Abgleichzeile({ darfAbgleichen }: { darfAbgleichen: boolean }) {
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
    ? new Date(s.gelaufen_am).toLocaleString("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="text-sm">
        {stand.isLoading && <span className="text-[var(--fg-muted)]">Abgleichstand wird geladen …</span>}
        {!stand.isLoading && !s && (
          <span className="text-[var(--fg-muted)]">
            Noch kein Abgleich gelaufen. Er läuft nachts um 02:15 von selbst.
          </span>
        )}
        {s && (
          <span className={cn(s.status === "fehler" && "text-[var(--danger)]")}>
            Letzter Abgleich {zeitpunkt} · {s.status} ·{" "}
            <span className="text-[var(--fg-muted)] tabular-nums">
              {fmt.zahl(s.mitarbeiter)} Personen, {fmt.zahl(s.anwesenheiten)} Anwesenheiten,{" "}
              {fmt.zahl(s.abwesenheiten)} Abwesenheiten
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
          {anstossen.isPending ? "läuft …" : "Jetzt abgleichen"}
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
  const [zeitraum, setZeitraum] = useState<Zeitraum>("jahr");
  const { von, bis } = useMemo(() => personalFenster(zeitraum), [zeitraum]);
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
        label: bucketLabel(p.bucket, t),
        ueberstunden: p.ueberstunden_quote == null ? null : p.ueberstunden_quote * 100,
        krankheit: p.krankheits_quote == null ? null : p.krankheits_quote * 100,
      })),
    [verlaufDaten, t],
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
            <ArrowLeft className="h-4 w-4" /> Übersicht
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Personal</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Aus dem Personio-Abgleich. Das Tagessoll kommt aus dem hinterlegten
            Arbeitszeitmodell je Person, nicht aus einem pauschalen Achtstundentag.
          </p>
          <div className="mt-2 flex gap-4 text-sm">
            <Link href="/hr/kompetenzen" className="underline-offset-4 hover:underline">
              Kompetenzen
            </Link>
            <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
              Schulungen
            </Link>
          </div>
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

      <Abgleichzeile darfAbgleichen={darfAbgleichen} />

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Kennzahlen konnten nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      {keineDaten && (
        <Card className="p-8 text-center">
          <p className="font-medium">Für diesen Zeitraum liegen keine Anwesenheiten vor</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            Entweder ist der Personio-Abgleich noch nicht gelaufen, oder der Zeitraum liegt
            vor dem Beginn der Aufzeichnung.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kachel
          titel="Überstunden-Quote"
          wert={fmt.prozent(ueber.data?.quote)}
          hinweis={
            ueber.data
              ? `${fmt.zahl(Math.round(ueber.data.ueberstunden))} von ${fmt.zahl(Math.round(ueber.data.ist_stunden))} Std.`
              : undefined
          }
          warnung={verfehlt(ueber.data?.quote ?? null, ziel["hr_ueberstunden"], "max")}
          laedt={laedt}
        />
        <Kachel
          titel="Krankheitsquote"
          wert={krank.data?.eingerichtet === false ? "—" : fmt.prozent(krank.data?.quote)}
          hinweis={
            krank.data?.eingerichtet === false
              ? "Krankheitsarten nicht hinterlegt"
              : krank.data
                ? `${fmt.zahl(Math.round(krank.data.krank_stunden))} von ${fmt.zahl(Math.round(krank.data.soll_stunden))} Std.`
                : undefined
          }
          warnung={verfehlt(krank.data?.quote ?? null, ziel["hr_krankheit"], "max")}
          laedt={laedt}
        />
        <Kachel
          titel="Fluktuation"
          wert={fmt.prozent(fluk.data?.quote)}
          hinweis={
            fluk.data
              ? `${fmt.zahl(fluk.data.austritte)} Austritte, Ø ${fluk.data.bestand_schnitt.toFixed(1)} Beschäftigte`
              : undefined
          }
          warnung={verfehlt(fluk.data?.quote ?? null, ziel["hr_fluktuation"], "max")}
          laedt={laedt}
        />
        <Kachel
          titel="Erfasste Personen"
          wert={fmt.zahl(ueber.data?.personen)}
          hinweis="mit Anwesenheit im Zeitraum"
          laedt={laedt}
        />
      </div>

      {krank.data?.eingerichtet === false && (
        <Card className="flex items-start gap-3 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fg-muted)]" />
          <p>
            Die Krankheitsquote bleibt leer, solange nicht hinterlegt ist, welche
            Personio-Abwesenheitsarten als Krankheit zählen. Einzutragen unter{" "}
            <Link href="/einstellungen" className="underline underline-offset-4">
              Einstellungen
            </Link>
            .
          </p>
        </Card>
      )}

      <Belegschaft />

      <Mitarbeitertabelle von={von} bis={bis} />

      {darfAbgleichen && <Wochenbericht />}

      <Card className="p-4">
        <h2 className="text-base font-semibold">Verlauf</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {t === "day" ? "je Tag" : t === "week" ? "je Woche" : "je Monat"}
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
                      name === "ueberstunden" ? "Überstunden" : "Krankheit",
                    ] as [string, string]
                  }
                />
                <Legend
                  formatter={(name) => (name === "ueberstunden" ? "Überstunden" : "Krankheit")}
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
