"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
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
import { alterInTagen } from "@/lib/datenstand";
import { Card } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Seitenkopf } from "@/components/seitenkopf";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { ZAHL_TAG } from "@/lib/sprache";
import { STUFEN_MIT_FENSTER, Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { DiagrammartWahl, useDiagrammart } from "@/components/kpi/diagrammart";
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

const TOOLTIP_STIL = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--fg)",
};

/**
 * Der Datenstand der Seite unter der Zeitraumwahl (KPI-08): wann der
 * Personio-Abgleich zuletzt lief. Darauf stehen alle Zahlen hier außer dem
 * Auftragswert der Kachel „Umsatz / Produktions-MA“.
 */
function Abgleichstand() {
  const worte = useTexte();
  const fmt = useFormate();
  const tag = ZAHL_TAG[useSprache()];
  const stand = useQuery({
    queryKey: personalKeys.abgleich(),
    queryFn: personalApi.abgleichstand,
  });
  // Der letzte geglückte Stand — nur nötig, wenn der jüngste Lauf gescheitert ist.
  const erfolg = useQuery({
    queryKey: personalKeys.abgleichErfolg(),
    queryFn: personalApi.abgleichLetzterErfolg,
    enabled: stand.data?.status === "fehler",
  });

  if (stand.isLoading) return null;
  const s = stand.data;
  const zeit = (iso: string) =>
    new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const alter = (tage: number) =>
    tage === 0 ? worte.datenstand.heute : tage === 1 ? worte.datenstand.gestern : worte.datenstand.vorTagen(tage);

  return (
    <div className="flex flex-col items-end gap-0.5 text-xs text-[var(--fg-muted)]">
      {s ? (
        <>
          <p
            className={cn(s.status === "fehler" && "text-[var(--danger)]")}
            title={[
              worte.personal.bestand(fmt.zahl(s.mitarbeiter), fmt.zahl(s.anwesenheiten), fmt.zahl(s.abwesenheiten)),
              s.fehler,
            ]
              .filter(Boolean)
              .join("\n")}
          >
            {worte.personal.abgleichStand(zeit(s.gelaufen_am), alter(alterInTagen(s.gelaufen_am)))}
            {s.status === "fehler" && ` · ${worte.personal.abgleichFehler}`}
          </p>
          {/* Ist der jüngste Lauf gescheitert, steht hier eindeutig der letzte
              erfolgreiche Stand — so weiß man, wie alt die Zahlen wirklich sind. */}
          {s.status === "fehler" && erfolg.data && (
            <p>
              {worte.personal.letzterErfolg(
                zeit(erfolg.data.gelaufen_am),
                alter(alterInTagen(erfolg.data.gelaufen_am)),
              )}
            </p>
          )}
        </>
      ) : (
        <p>{worte.personal.keinAbgleich}</p>
      )}
    </div>
  );
}

/**
 * Wer HR verwalten darf, stößt den Personio-Abgleich an — als Knopf in der
 * rechten Leiste bei den Aktionen. Ein Fehler erscheint als Meldung.
 */
function AbgleichKnopf() {
  const worte = useTexte();
  const qc = useQueryClient();
  const anstossen = useMutation({
    mutationFn: personalApi.abgleichAnstossen,
    onSuccess: () => qc.invalidateQueries({ queryKey: personalKeys.alle() }),
    onError: (fehler) => toast.error((fehler as Error).message),
  });

  return (
    <button
      type="button"
      onClick={() => anstossen.mutate()}
      disabled={anstossen.isPending}
      className={
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm " +
        "hover:bg-[var(--muted)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
      }
    >
      <RefreshCw className={cn("h-4 w-4 text-[var(--fg-muted)]", anstossen.isPending && "animate-spin")} aria-hidden />
      {anstossen.isPending ? worte.personal.abgleichLaeuft : worte.personal.abgleichen}
    </button>
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
  const [artQuoten, setArtQuoten] = useDiagrammart();
  const [artKopf, setArtKopf] = useDiagrammart();

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
  const kopf = useQuery({
    queryKey: [...personalKeys.fenster(von, bis), "umsatz-je-kopf"],
    queryFn: () => personalApi.umsatzJeProduktionskopf(von, bis),
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
  const vglKopf = useVergleich(
    ["hr", "umsatz-je-kopf"],
    zeitraum,
    von,
    bis,
    personalApi.umsatzJeProduktionskopf,
  );

  const verlauf = useQuery({
    queryKey: [...personalKeys.fenster(von, bis), "verlauf"],
    queryFn: () => personalApi.verlauf(von, bis),
  });
  const kopfVerlauf = useQuery({
    queryKey: [...personalKeys.fenster(von, bis), "umsatz-je-kopf-verlauf"],
    queryFn: () => personalApi.umsatzJeProduktionskopfVerlauf(von, bis),
  });
  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const ziel = nachSchluessel(ziele.data ?? []);
  const zielKopf = ziel["hr_umsatz_je_produktionskopf"];

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
  const kopfVerlaufDaten = kopfVerlauf.data;
  const kopfDaten = useMemo(
    () => (kopfVerlaufDaten ?? []).map((p) => ({ label: fmt.bucket(p.bucket, t), wert: p.wert })),
    [kopfVerlaufDaten, t, fmt],
  );

  const laedt = ueber.isLoading || krank.isLoading || fluk.isLoading;
  const keineDaten = !ueber.isLoading && ueber.data?.ist_stunden === 0 && ueber.data?.personen === 0;
  const fehler =
    ueber.error ?? krank.error ?? fluk.error ?? kopf.error ?? verlauf.error ?? kopfVerlauf.error ?? ziele.error;
  const taktText = t === "day" ? worte.dashboard.jeTag : t === "week" ? worte.dashboard.jeWoche : worte.dashboard.jeMonat;
  const reiheName = (name: unknown) =>
    name === "ueberstunden" ? worte.personal.reiheUeberstunden : worte.personal.reiheKrankheit;

  return (
    <div className="space-y-6">
      <Seitenkopf
        bedienung={
          <>
            {darfAbgleichen && <AbgleichKnopf />}
            <Zeitraumwahl wahl={wahl} stufen={STUFEN_MIT_FENSTER} datenstand={<Abgleichstand />} />
          </>
        }
      />

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              vorjahrLabel={vglUeber.labelVorjahr}
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
              vorjahrLabel={vglKrank.labelVorjahr}
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
              vorjahrLabel={vglFluk.labelVorjahr}
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
        <Kennzahl
          titel={worte.personal.umsatzJeKopf}
          wert={kopf.data?.eingerichtet === false ? "—" : fmt.eur(kopf.data?.wert)}
          hinweis={
            kopf.data?.eingerichtet === false
              ? worte.personal.produktionFehlt
              : kopf.data
                ? worte.personal.umsatzJeKopfHinweis(fmt.eur(kopf.data.auftragswert), fmt.zahl(kopf.data.koepfe))
                : undefined
          }
          warnung={verfehlt(kopf.data?.wert ?? null, zielKopf, "min")}
          vergleich={
            <Vergleiche
              aktuell={kopf.data?.wert}
              vorperiode={vglKopf.vorperiode?.wert}
              vorjahr={vglKopf.vorjahr?.wert}
              vorperiodeLabel={vglKopf.label}
              vorjahrLabel={vglKopf.labelVorjahr}
              richtung="mehr_ist_besser"
            />
          }
          laedt={kopf.isLoading}
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
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">{worte.personal.verlauf}</h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">{taktText}</p>
          </div>
          <DiagrammartWahl art={artQuoten} onChange={setArtQuoten} />
        </div>
        <div className="mt-4 h-72">
          {chartDaten.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--fg-muted)]">
              {verlauf.isLoading ? worte.dashboard.laedt : worte.wochenbericht.keineWerte}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartDaten} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
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
                  contentStyle={TOOLTIP_STIL}
                  formatter={(wert, name) =>
                    [wert == null ? "—" : `${Number(wert).toFixed(2)} %`, reiheName(name)] as [string, string]
                  }
                />
                <Legend formatter={reiheName} wrapperStyle={{ fontSize: 12 }} />
                {ziel["hr_ueberstunden"] != null && (
                  <ReferenceLine
                    y={ziel["hr_ueberstunden"] * 100}
                    stroke="var(--fg-muted)"
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                  />
                )}
                {artQuoten === "balken" && (
                  <Bar dataKey="ueberstunden" fill="var(--ring)" />
                )}
                {artQuoten === "balken" && (
                  <Bar dataKey="krankheit" fill="var(--danger)" />
                )}
                {/* Übereinander, nicht gestapelt: die Quoten sind keine Summe. */}
                {artQuoten === "flaeche" && (
                  <Area
                    type="monotone"
                    dataKey="ueberstunden"
                    stroke="var(--ring)"
                    fill="var(--ring)"
                    fillOpacity={0.25}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {artQuoten === "flaeche" && (
                  <Area
                    type="monotone"
                    dataKey="krankheit"
                    stroke="var(--danger)"
                    fill="var(--danger)"
                    fillOpacity={0.25}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">{worte.personal.reiheUmsatzJeKopf}</h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">{taktText}</p>
          </div>
          <DiagrammartWahl art={artKopf} onChange={setArtKopf} />
        </div>
        <div className="mt-4 h-72">
          {kopfDaten.every((p) => p.wert == null) ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--fg-muted)]">
              {kopfVerlauf.isLoading
                ? worte.dashboard.laedt
                : kopf.data?.eingerichtet === false
                  ? worte.personal.produktionFehlt
                  : worte.wochenbericht.keineWerte}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={kopfDaten} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
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
                  width={80}
                  tickFormatter={(v: number) => fmt.eur(v)}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STIL}
                  formatter={(wert) =>
                    [wert == null ? "—" : fmt.eur(Number(wert)), worte.personal.umsatzJeKopf] as [string, string]
                  }
                />
                {zielKopf != null && (
                  <ReferenceLine
                    y={zielKopf}
                    stroke="var(--fg-muted)"
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={{
                      value: worte.personal.ziel(fmt.eur(zielKopf)),
                      position: "insideBottomRight",
                      fill: "var(--fg-muted)",
                      fontSize: 11,
                    }}
                  />
                )}
                {artKopf === "balken" && <Bar dataKey="wert" fill="var(--ring)" />}
                {artKopf === "flaeche" && (
                  <Area
                    type="monotone"
                    dataKey="wert"
                    stroke="var(--ring)"
                    fill="var(--ring)"
                    fillOpacity={0.25}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
