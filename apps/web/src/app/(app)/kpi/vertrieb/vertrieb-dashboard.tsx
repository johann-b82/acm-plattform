"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  umsatzTakt,
  kundenfarben,
  vergleichsart,
  verlaufMitVergleich,
  vertriebApi,
  zeitraumText,
  type Einzelauftrag,
  type ErfasserZeile,
  type KundenAnteil,
  type VerlaufZeile,
} from "@/lib/kpi/vertrieb";
import { vergleichsfenster } from "@/lib/kpi/vergleich";
import { Card } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { DiagrammartWahl, useDiagrammart } from "@/components/kpi/diagrammart";
import { Seitenkopf } from "@/components/seitenkopf";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { ZAHL_TAG } from "@/lib/sprache";
import { AktivitaetKarte } from "./aktivitaet-karte";
import { KundenanteilDiagramm } from "./kundenanteil-diagramm";

/** Eine feste leere Menge: die Tabelle springt bei jeder neuen Menge auf Seite 1. */
const KEINE: never[] = [];

/** Die Kundenanteilsdiagramme zeigen höchstens so viele Kunden einzeln. */
const HOECHSTENS_KUNDEN = 14;

export function VertriebDashboard() {
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const worte = useTexte();
  const fmt = useFormate();
  const sprachTag = ZAHL_TAG[useSprache()];
  // Im gewählten Monat nach Kalenderwochen, sonst monatlich (umsatzTakt).
  // Achsenbeschriftung, Vergleichsreihe, Tooltip und Prozentwerte folgen
  // demselben Takt — sonst zeigte die Achse Wochen und die Reihe Monate.
  const t = umsatzTakt(zeitraum);
  const [diagrammart, setDiagrammart] = useDiagrammart();

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
    queryKey: ["kpi", "vertrieb", "verlauf", von, bis, t],
    queryFn: () => vertriebApi.verlauf(von, bis, t),
  });

  // Vergleichsreihe im Verlauf (VER-04A): dieselben Fenster wie die Kacheln,
  // derselbe Takt wie die aktuelle Reihe — sonst lägen Tage neben Wochen.
  const art = vergleichsart(zeitraum);
  const vorFenster = useMemo(() => {
    const f = vergleichsfenster(zeitraum, von, bis);
    return art === "vorjahr" ? f.vorjahr : null;
  }, [art, zeitraum, von, bis]);
  const verlaufVorher = useQuery({
    queryKey: ["kpi", "vertrieb", "verlauf", "vergleich", vorFenster?.von, vorFenster?.bis, t],
    queryFn: () => vertriebApi.verlauf(vorFenster!.von, vorFenster!.bis, t),
    enabled: vorFenster !== null,
  });

  const kunden = useQuery({
    queryKey: ["kpi", "vertrieb", "kunden", "revenues", von, bis],
    queryFn: () => vertriebApi.kundenanteil("revenues", von, bis),
  });
  const kundenAuftraege = useQuery({
    queryKey: ["kpi", "vertrieb", "kunden", "auftraege", von, bis],
    queryFn: () => vertriebApi.kundenanteil("auftraege", von, bis),
  });
  const erfasser = useQuery({
    queryKey: ["kpi", "vertrieb", "erfasser", von, bis],
    queryFn: () => vertriebApi.jeErfasser(von, bis),
  });
  const einzelauftraege = useQuery({
    queryKey: ["kpi", "vertrieb", "einzelauftraege", von, bis],
    queryFn: () => vertriebApi.einzelauftraege(von, bis),
  });

  const chartDaten = useMemo(
    () =>
      verlaufMitVergleich(
        verlauf.data ?? [],
        vorFenster ? (verlaufVorher.data ?? null) : null,
        von && bis ? { von, bis } : null,
        vorFenster,
        t,
      ),
    [verlauf.data, verlaufVorher.data, vorFenster, von, bis, t],
  );
  const nameAktuell =
    von && bis && vorFenster
      ? worte.vertrieb.umsatzIn(zeitraumText(zeitraum, { von, bis }, sprachTag, worte.vergleich))
      : worte.vertrieb.umsatz;
  const nameVorher = vorFenster
    ? worte.vertrieb.umsatzIn(zeitraumText(zeitraum, vorFenster, sprachTag, worte.vergleich))
    : null;
  const mitVergleich = nameVorher !== null && verlaufVorher.data !== undefined;

  const farben = useMemo(
    () =>
      kundenfarben([
        (kundenAuftraege.data ?? []).slice(0, HOECHSTENS_KUNDEN).map((k) => k.kunde),
        (kunden.data ?? []).slice(0, HOECHSTENS_KUNDEN).map((k) => k.kunde),
      ]),
    [kundenAuftraege.data, kunden.data],
  );

  const datum = useMemo(
    () => new Intl.DateTimeFormat(sprachTag, { day: "2-digit", month: "2-digit", year: "numeric" }),
    [sprachTag],
  );

  const kundenGesamt = useMemo(
    () => (kunden.data ?? []).reduce((summe, k) => summe + Number(k.wert), 0),
    [kunden.data],
  );
  const anteilVon = (k: KundenAnteil) => (kundenGesamt === 0 ? 0 : Number(k.wert) / kundenGesamt);
  const prozentGenau = useMemo(
    () => new Intl.NumberFormat(sprachTag, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [sprachTag],
  );

  const kundenSpalten: Tabellenspalte<KundenAnteil>[] = [
    { schluessel: "kunde", titel: worte.vertrieb.kunde, typ: "text", wert: (k) => k.kunde },
    {
      schluessel: "wert",
      titel: worte.vertrieb.umsatz,
      typ: "zahl",
      wert: (k) => Number(k.wert),
      zelle: (k) => fmt.eur(Number(k.wert)),
      ausrichtung: "end",
      className: "font-mono",
    },
    {
      schluessel: "anteil",
      titel: worte.vertrieb.anteil,
      typ: "zahl",
      // Aus dem ungerundeten Betrag, nicht aus der in SQL gerundeten Spalte:
      // sonst stünde hier 5,3 % und im Diagramm darüber 5,2 %.
      wert: (k) => anteilVon(k),
      zelle: (k) => prozentGenau.format(anteilVon(k) || 0),
      ausrichtung: "end",
      className: "font-mono",
    },
  ];
  const erfasserSpalten: Tabellenspalte<ErfasserZeile>[] = [
    { schluessel: "erfasser", titel: worte.vertrieb.erfasser, typ: "text", wert: (e) => e.erfasser },
    {
      schluessel: "anzahl",
      titel: worte.vertrieb.anzahl,
      typ: "zahl",
      wert: (e) => Number(e.auftraege_anzahl),
      zelle: (e) => fmt.zahl(Number(e.auftraege_anzahl)),
      ausrichtung: "end",
      className: "font-mono",
    },
    {
      schluessel: "summe",
      titel: worte.vertrieb.summe,
      typ: "zahl",
      wert: (e) => Number(e.wert_summe),
      zelle: (e) => fmt.eur(Number(e.wert_summe)),
      ausrichtung: "end",
      className: "font-mono",
    },
  ];
  // Die Spalten der Referenz (`SalesTable.tsx`) ohne Projekt und Restwert:
  // beides steht nur in der Altabelle `sales_records`, nicht im Auftragsexport.
  const auftragSpalten: Tabellenspalte<Einzelauftrag>[] = [
    {
      schluessel: "vorgang_nr",
      titel: worte.vertrieb.auftragsNr,
      typ: "text",
      wert: (a) => a.vorgang_nr,
      className: "font-mono text-xs",
    },
    { schluessel: "kunde", titel: worte.vertrieb.kunde, typ: "text", wert: (a) => a.customer_name },
    {
      schluessel: "datum",
      titel: worte.vertrieb.datum,
      typ: "datum",
      wert: (a) => a.datum,
      zelle: (a) => datum.format(new Date(`${a.datum}T12:00:00`)),
      suchtext: (a) => datum.format(new Date(`${a.datum}T12:00:00`)),
    },
    {
      schluessel: "gesamt",
      titel: worte.vertrieb.gesamt,
      typ: "zahl",
      wert: (a) => a.wert_eur,
      zelle: (a) => fmt.eur(a.wert_eur),
      ausrichtung: "end",
      className: "font-mono",
    },
  ];

  const keineDaten =
    !summe.isLoading && summe.data?.umsatz_zeilen === 0 && summe.data?.auftraege_anzahl === 0;

  const fehler =
    summe.error ??
    verlauf.error ??
    verlaufVorher.error ??
    kunden.error ??
    kundenAuftraege.error ??
    erfasser.error ??
    einzelauftraege.error;

  return (
    <div className="space-y-6">
      <Seitenkopf
        bedienung={
          <>
            <Zeitraumwahl wahl={wahl} datenstand={<Datenstand bereich="vertrieb" />} />
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

      {/* Fachliche Richtung der Vergleichsfarbe (KPI-06): mehr ist bei allen
          drei Kacheln günstig. Für den Ø Auftragswert steht das in der
          Nutzerentscheidung KPI-05 („im Vertriebsbeispiel Rückgänge rot“). */}
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
              vorjahrLabel={vgl.labelVorjahr}
              richtung="mehr_ist_besser"
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
              vorjahrLabel={vgl.labelVorjahr}
              richtung="mehr_ist_besser"
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
              vorjahrLabel={vgl.labelVorjahr}
              richtung="mehr_ist_besser"
            />
          }
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{worte.vertrieb.verlauf}</h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {worte.vertrieb.verlaufHinweis(
                t === "week" ? worte.dashboard.jeWoche : worte.dashboard.jeMonat,
              )}
            </p>
          </div>
          <DiagrammartWahl art={diagrammart} onChange={setDiagrammart} />
        </div>
        <div className="mt-4 h-72">
          {(verlauf.data ?? []).length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--fg-muted)]">
              {verlauf.isLoading ? worte.dashboard.laedt : worte.dashboard.keineWerte}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartDaten} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(b: string) => fmt.bucket(b, t)}
                  stroke="var(--fg-muted)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                {/* Eine Achse für beide Reihen: getrennte Skalen ließen das
                    Vorjahr gleich hoch aussehen, auch wenn es halb so groß war. */}
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
                  labelFormatter={(b) => fmt.bucket(String(b), t)}
                  formatter={(v, name, eintrag) => {
                    const zeile = eintrag?.payload as VerlaufZeile | undefined;
                    const betrag = v == null ? "—" : fmt.eurGenau(Number(v));
                    // Die Vergleichsreihe steht an der Stelle des aktuellen
                    // Buckets; welcher Monat bzw. Tag es wirklich war, steht dahinter.
                    const wann =
                      eintrag?.dataKey === "vorher" && zeile?.bucketVorher
                        ? ` (${fmt.bucket(zeile.bucketVorher, t)})`
                        : "";
                    return [`${betrag}${wann}`, String(name)] as [string, string];
                  }}
                />
                {mitVergleich && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {/* Ohne Animation: die Abfragen lösen zu unterschiedlichen Zeiten
                    aus, das Neurendern lässt die Einblendung hängen und die Balken
                    bleiben gestaucht stehen. Ein Dashboard braucht sie auch nicht. */}
                {diagrammart === "balken" ? (
                  <Bar
                    dataKey="umsatz"
                    name={nameAktuell}
                    fill="var(--ring)"
                    maxBarSize={mitVergleich ? 40 : 64}
                  />
                ) : (
                  <Area
                    type="monotone"
                    dataKey="umsatz"
                    name={nameAktuell}
                    stroke="var(--ring)"
                    strokeWidth={2}
                    fill="var(--ring)"
                    fillOpacity={0.15}
                    connectNulls
                  />
                )}
                {mitVergleich &&
                  (diagrammart === "balken" ? (
                    <Bar
                      dataKey="vorher"
                      name={nameVorher}
                      fill="var(--fg-muted)"
                      fillOpacity={0.55}
                      maxBarSize={40}
                    />
                  ) : (
                    <Area
                      type="monotone"
                      dataKey="vorher"
                      name={nameVorher}
                      stroke="var(--fg-muted)"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      fill="var(--fg-muted)"
                      fillOpacity={0.08}
                      connectNulls
                    />
                  ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-2">
        <KundenanteilDiagramm
          titel={worte.vertrieb.kundenanteilAuftraege}
          hinweis={worte.vertrieb.kundenanteilAuftraegeHinweis}
          kunden={kundenAuftraege.data}
          laedt={kundenAuftraege.isLoading}
          farben={farben}
        />
        <KundenanteilDiagramm
          titel={worte.vertrieb.kundenanteilRechnungen}
          hinweis={worte.vertrieb.kundenanteilRechnungenHinweis}
          kunden={kunden.data}
          laedt={kunden.isLoading}
          farben={farben}
        />
      </div>

      <AktivitaetKarte von={von} bis={bis} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-base font-semibold">{worte.vertrieb.kundenanteil}</h2>
          <Datentabelle
            zeilen={kunden.data ?? KEINE}
            spalten={kundenSpalten}
            zeilenSchluessel={(k) => k.kunde}
            vorsortierung={{ spalte: "wert", richtung: "ab" }}
            laedt={kunden.isLoading}
            leer={worte.dashboard.keineWerte}
            beschriftung={worte.vertrieb.kundenanteil}
          />
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold">{worte.vertrieb.jeErfasser}</h2>
          <Datentabelle
            zeilen={erfasser.data ?? KEINE}
            spalten={erfasserSpalten}
            zeilenSchluessel={(e) => e.erfasser}
            vorsortierung={{ spalte: "summe", richtung: "ab" }}
            laedt={erfasser.isLoading}
            leer={worte.dashboard.keineWerte}
            beschriftung={worte.vertrieb.jeErfasser}
          />
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold">{worte.vertrieb.einzelauftraege}</h2>
        <p className="mb-2 mt-1 text-xs text-[var(--fg-muted)]">{worte.vertrieb.einzelauftraegeHinweis}</p>
        <Datentabelle
          zeilen={einzelauftraege.data ?? KEINE}
          spalten={auftragSpalten}
          zeilenSchluessel={(a) => a.vorgang_nr}
          vorsortierung={{ spalte: "datum", richtung: "ab" }}
          laedt={einzelauftraege.isLoading}
          leer={worte.dashboard.keineWerte}
          beschriftung={worte.vertrieb.einzelauftraege}
        />
      </div>
    </div>
  );
}
