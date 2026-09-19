"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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


import { vertriebApi, wochenfenster, type AktivitaetZeile } from "@/lib/kpi/vertrieb";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { Card } from "@/components/ui/primitives";
import { DiagrammartWahl, useDiagrammart } from "@/components/kpi/diagrammart";

/**
 * Vertriebsaktivität: fünf Diagramme über dieselbe Wochenachse, je als
 * Balken oder Fläche (VER-04B).
 *
 * Der Wert ist die Wochensumme über alle Vertriebler; wer wie viel
 * beigetragen hat, steht im Tooltip. Die Datenbank liefert genau dafür eine
 * Zeile je Woche und Vertriebler — eine Abfrage für Balken und Aufteilung.
 *
 * Besuche stehen getrennt nach vor Ort und online übereinander (VER-04C), wie
 * in `SalesActivityCard.tsx`. Gestapelt auch als Fläche: anders als Vorjahr
 * und laufendes Jahr sind die beiden Arten Teile einer Summe, und das Ziel
 * „3 / Woche“ gilt dieser Summe — es wird nicht je Art verdoppelt.
 *
 * Die Karte hängt nicht am Zeitraumwähler des Dashboards: sie zeigt Wochen,
 * und „Dieser Monat" ergäbe vier Balken. Siehe `wochenfenster`.
 */

interface Woche {
  schluessel: string;
  label: string;
  erstkontakte: number;
  besuche_ort: number;
  besuche_onl: number;
  besuche: number;
  angebote_eur: number;
  auftraege_eur: number;
  interessenten: number;
  /** Je Kennzahl die Aufteilung auf die Vertriebler, für den Tooltip. */
  anteile: Record<string, [string, number][]>;
}

type Feld = "erstkontakte" | "besuche_ort" | "besuche_onl" | "angebote_eur" | "auftraege_eur" | "interessenten";

const DIAGRAMME: {
  schluessel: string;
  /** Die gezeichneten Reihen; mehr als eine wird gestapelt. */
  reihen: Feld[];
  /** Die Wochensumme — für Achsenbreite und Ziellinie. */
  summe: Feld | "besuche";
  /** Schlüssel im Wörterbuch; `<name>Hinweis` ist die Zeile darunter. */
  wort: "erstkontakte" | "besuche" | "interessenten" | "angebote" | "auftragseingang";
  zielSchluessel: string;
  einheit: "anzahl" | "eur";
  /** Interessenten kommen ohne Vertriebler — dort gibt es nichts aufzuteilen. */
  mitAnteilen: boolean;
}[] = [
  {
    schluessel: "erstkontakte",
    reihen: ["erstkontakte"],
    summe: "erstkontakte",
    wort: "erstkontakte",
    zielSchluessel: "vertrieb_erstkontakte",
    einheit: "anzahl",
    mitAnteilen: true,
  },
  {
    schluessel: "besuche",
    reihen: ["besuche_ort", "besuche_onl"],
    summe: "besuche",
    wort: "besuche",
    zielSchluessel: "vertrieb_besuche",
    einheit: "anzahl",
    mitAnteilen: true,
  },
  {
    schluessel: "interessenten",
    reihen: ["interessenten"],
    summe: "interessenten",
    wort: "interessenten",
    zielSchluessel: "vertrieb_interessenten",
    einheit: "anzahl",
    mitAnteilen: false,
  },
  {
    schluessel: "angebote",
    reihen: ["angebote_eur"],
    summe: "angebote_eur",
    wort: "angebote",
    zielSchluessel: "vertrieb_angebote_eur",
    einheit: "eur",
    mitAnteilen: true,
  },
  {
    schluessel: "auftraege",
    reihen: ["auftraege_eur"],
    summe: "auftraege_eur",
    wort: "auftragseingang",
    zielSchluessel: "vertrieb_auftraege_eur",
    einheit: "eur",
    mitAnteilen: true,
  },
];

/** Die zweite Besuchsart in einem helleren Ton derselben Farbe — Teil derselben Summe. */
const FARBE: Record<Feld, string> = {
  erstkontakte: "var(--ring)",
  besuche_ort: "var(--ring)",
  besuche_onl: "color-mix(in oklab, var(--ring) 45%, var(--surface))",
  angebote_eur: "var(--ring)",
  auftraege_eur: "var(--ring)",
  interessenten: "var(--ring)",
};

function anteileHinzu(
  ziel: Record<string, [string, number][]>,
  feld: string,
  erfasser: string,
  wert: number,
) {
  if (wert <= 0) return;
  (ziel[feld] ??= []).push([erfasser, wert]);
}

/** Zeilen je Woche und Vertriebler zu einer Zeile je Woche verdichten. */
export function verdichte(
  zeilen: AktivitaetZeile[],
  interessenten: { iso_jahr: number; iso_woche: number; anzahl: number }[],
): Woche[] {
  const wochen = new Map<string, Woche>();

  const hole = (jahr: number, woche: number): Woche => {
    const schluessel = `${jahr}-${String(woche).padStart(2, "0")}`;
    let w = wochen.get(schluessel);
    if (!w) {
      w = {
        schluessel,
        label: String(woche).padStart(2, "0"),
        erstkontakte: 0,
        besuche_ort: 0,
        besuche_onl: 0,
        besuche: 0,
        angebote_eur: 0,
        auftraege_eur: 0,
        interessenten: 0,
        anteile: {},
      };
      wochen.set(schluessel, w);
    }
    return w;
  };

  for (const z of zeilen) {
    const w = hole(z.iso_jahr, z.iso_woche);
    const ers = Number(z.erstkontakte);
    const ort = Number(z.besuche_ort);
    const onl = Number(z.besuche_onl);
    const ang = Number(z.angebote_eur);
    const auf = Number(z.auftraege_eur);
    w.erstkontakte += ers;
    w.besuche_ort += ort;
    w.besuche_onl += onl;
    w.besuche += ort + onl;
    w.angebote_eur += ang;
    w.auftraege_eur += auf;
    anteileHinzu(w.anteile, "erstkontakte", z.erfasser, ers);
    anteileHinzu(w.anteile, "besuche_ort", z.erfasser, ort);
    anteileHinzu(w.anteile, "besuche_onl", z.erfasser, onl);
    anteileHinzu(w.anteile, "angebote_eur", z.erfasser, ang);
    anteileHinzu(w.anteile, "auftraege_eur", z.erfasser, auf);
  }

  for (const i of interessenten) {
    hole(i.iso_jahr, i.iso_woche).interessenten += Number(i.anzahl);
  }

  return [...wochen.values()].sort((a, b) => a.schluessel.localeCompare(b.schluessel));
}

function Diagramm({
  daten,
  reihen,
  summe,
  titel,
  hinweis,
  ziel,
  einheit,
  mitAnteilen,
}: {
  daten: Woche[];
  reihen: Feld[];
  summe: Feld | "besuche";
  titel: string;
  hinweis: string;
  ziel: number | undefined;
  einheit: "anzahl" | "eur";
  mitAnteilen: boolean;
}) {
  const worte = useTexte();
  const fmt = useFormate();
  const [art, setArt] = useDiagrammart();
  const zeige = einheit === "eur" ? fmt.eur : fmt.zahl;
  const zeigeGenau = einheit === "eur" ? fmt.eurGenau : fmt.zahl;
  const gestapelt = reihen.length > 1;
  const reihenname = (feld: Feld) =>
    feld === "besuche_ort" ? worte.aktivitaet.besucheOrt : feld === "besuche_onl" ? worte.aktivitaet.besucheOnline : titel;

  // Die Achse muss so breit sein wie ihre längste Beschriftung. Eine feste
  // Breite reichte, solange die Angebote fünfstellig waren; mit den echten
  // Zahlen steht dort „1.000.000 €“, und von der Million war die erste Ziffer
  // abgeschnitten. Gerechnet wird über den größten Wert, nicht über alle —
  // die längste Zahl ist immer die größte.
  const achsenbreite = useMemo(() => {
    const groesster = daten.reduce((h, w) => Math.max(h, Number(w[summe] ?? 0)), 0);
    const zeichen = zeige(groesster).length;
    return Math.min(96, Math.max(36, 12 + zeichen * 7));
  }, [daten, summe, zeige]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{titel}</h3>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            {hinweis}
            {ziel != null && <> · {worte.aktivitaet.ziel(zeige(ziel))}</>}
          </p>
        </div>
        <DiagrammartWahl art={art} onChange={setArt} />
      </div>
      <div className="mt-3 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={daten} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tickFormatter={(w: string) => worte.aktivitaet.kw(w)}
              stroke="var(--fg-muted)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="var(--fg-muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={achsenbreite}
              tickFormatter={(v: number) => zeige(v)}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--fg)",
              }}
              formatter={(wert, name, eintrag) => {
                const woche = eintrag?.payload as Woche | undefined;
                const anteile = mitAnteilen ? (woche?.anteile[String(eintrag?.dataKey)] ?? []) : [];
                const aufteilung = anteile
                  .slice()
                  .sort((a, b) => b[1] - a[1])
                  .map(([wer, v]) => `${wer} ${zeigeGenau(v)}`)
                  .join(" · ");
                // Recharts setzt "name: value" — der Name gehoert also nach
                // vorne. Die Aufteilung haengt an den Wert, sonst stuende sie
                // vor der Zahl, um die es geht.
                return [
                  aufteilung
                    ? `${zeigeGenau(Number(wert))}  (${aufteilung})`
                    : zeigeGenau(Number(wert)),
                  String(name),
                ] as [string, string];
              }}
              labelFormatter={(label, nutzlast) => {
                const woche = nutzlast?.[0]?.payload as Woche | undefined;
                return woche
                  ? `${worte.aktivitaet.kw(String(label))} / ${woche.schluessel.slice(0, 4)}`
                  : String(label);
              }}
            />
            {gestapelt && <Legend verticalAlign="top" height={20} iconSize={10} wrapperStyle={{ fontSize: 11 }} />}
            {ziel != null && (
              <ReferenceLine
                y={ziel}
                stroke="var(--fg-muted)"
                strokeDasharray="4 4"
                // Ohne `extendDomain` verschwindet die Ziellinie genau dann,
                // wenn kein Balken sie erreicht — also wenn man sie am
                // nötigsten sieht. Recharts skaliert sonst nur nach den Daten.
                //
                // Die Beschriftung steht in der Überschrift, nicht an der
                // Linie: liegt das Ziel nahe null (Angebote gegen 600.000 €),
                // rutscht ein Label an der Linie in die Achsenbeschriftung.
                ifOverflow="extendDomain"
              />
            )}
            {reihen.map((feld) =>
              art === "balken" ? (
                <Bar
                  key={feld}
                  dataKey={feld}
                  name={reihenname(feld)}
                  stackId={gestapelt ? "summe" : undefined}
                  fill={FARBE[feld]}
                  maxBarSize={28}
                />
              ) : (
                <Area
                  key={feld}
                  type="monotone"
                  dataKey={feld}
                  name={reihenname(feld)}
                  stackId={gestapelt ? "summe" : undefined}
                  stroke={FARBE[feld]}
                  strokeWidth={2}
                  fill={FARBE[feld]}
                  fillOpacity={0.3}
                  connectNulls={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function AktivitaetKarte({ von, bis }: { von: string | null; bis: string | null }) {
  const worte = useTexte();
  const fenster = useMemo(() => wochenfenster(von, bis), [von, bis]);

  const aktivitaet = useQuery({
    queryKey: ["kpi", "vertrieb", "aktivitaet", fenster.von, fenster.bis],
    queryFn: () => vertriebApi.aktivitaet(fenster.von, fenster.bis),
  });
  const interessenten = useQuery({
    queryKey: ["kpi", "vertrieb", "interessenten", fenster.von, fenster.bis],
    queryFn: () => vertriebApi.interessenten(fenster.von, fenster.bis),
  });
  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const zielNach = nachSchluessel(ziele.data ?? []);

  const daten = useMemo(
    () => verdichte(aktivitaet.data ?? [], interessenten.data ?? []),
    [aktivitaet.data, interessenten.data],
  );

  const laedt = aktivitaet.isLoading || interessenten.isLoading;
  const fehler = aktivitaet.error ?? interessenten.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{worte.aktivitaet.titel}</h2>
        <p className="text-xs text-[var(--fg-muted)]">
          {worte.aktivitaet.jeWoche(fenster.von, fenster.bis)}
        </p>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {worte.aktivitaet.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      {!fehler && daten.length === 0 && (
        <Card className="p-6 text-center text-sm text-[var(--fg-muted)]">
          {laedt ? worte.dashboard.laedt : worte.aktivitaet.leer}
        </Card>
      )}

      {!fehler && daten.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {DIAGRAMME.map((d) => (
            <Diagramm
              key={d.schluessel}
              daten={daten}
              reihen={d.reihen}
              summe={d.summe}
              titel={worte.aktivitaet[d.wort]}
              hinweis={worte.aktivitaet[`${d.wort}Hinweis`]}
              ziel={zielNach[d.zielSchluessel]}
              einheit={d.einheit}
              mitAnteilen={d.mitAnteilen}
            />
          ))}
        </div>
      )}
    </section>
  );
}
