"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmt } from "@/lib/kpi/gemeinsam";
import { vertriebApi, wochenfenster, type AktivitaetZeile } from "@/lib/kpi/vertrieb";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Card } from "@/components/ui/primitives";

/**
 * Vertriebsaktivität: fünf Balkendiagramme über dieselbe Wochenachse.
 *
 * Der Balken ist die Wochensumme über alle Vertriebler; wer wie viel
 * beigetragen hat, steht im Tooltip. Die Datenbank liefert genau dafür eine
 * Zeile je Woche und Vertriebler — eine Abfrage für Balken und Aufteilung.
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

type Feld = "erstkontakte" | "besuche" | "angebote_eur" | "auftraege_eur" | "interessenten";

const DIAGRAMME: {
  feld: Feld;
  titel: string;
  hinweis: string;
  zielSchluessel: string;
  einheit: "anzahl" | "eur";
  /** Interessenten kommen ohne Vertriebler — dort gibt es nichts aufzuteilen. */
  mitAnteilen: boolean;
}[] = [
  {
    feld: "erstkontakte",
    titel: "Erstkontakte",
    hinweis: "erledigte Kontakte vom Typ ERS",
    zielSchluessel: "vertrieb_erstkontakte",
    einheit: "anzahl",
    mitAnteilen: true,
  },
  {
    feld: "besuche",
    titel: "Besuche",
    hinweis: "vor Ort und online zusammen",
    zielSchluessel: "vertrieb_besuche",
    einheit: "anzahl",
    mitAnteilen: true,
  },
  {
    feld: "interessenten",
    titel: "Interessenten",
    hinweis: "neu erfasst, ohne Vertriebler-Zuordnung",
    zielSchluessel: "vertrieb_interessenten",
    einheit: "anzahl",
    mitAnteilen: false,
  },
  {
    feld: "angebote_eur",
    titel: "Angebote",
    hinweis: "Summe der geschriebenen Angebote",
    zielSchluessel: "vertrieb_angebote_eur",
    einheit: "eur",
    mitAnteilen: true,
  },
  {
    feld: "auftraege_eur",
    titel: "Auftragseingang",
    hinweis: "Stornos gegengerechnet",
    zielSchluessel: "vertrieb_auftraege_eur",
    einheit: "eur",
    mitAnteilen: true,
  },
];

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
        label: `KW ${String(woche).padStart(2, "0")}`,
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
    anteileHinzu(w.anteile, "besuche", z.erfasser, ort + onl);
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
  feld,
  titel,
  hinweis,
  ziel,
  einheit,
  mitAnteilen,
}: {
  daten: Woche[];
  feld: Feld;
  titel: string;
  hinweis: string;
  ziel: number | undefined;
  einheit: "anzahl" | "eur";
  mitAnteilen: boolean;
}) {
  const zeige = einheit === "eur" ? fmt.eur : fmt.zahl;
  const zeigeGenau = einheit === "eur" ? fmt.eurGenau : fmt.zahl;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{titel}</h3>
      <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
        {hinweis}
        {ziel != null && <> · Ziel {zeige(ziel)} / Woche</>}
      </p>
      <div className="mt-3 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={daten} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
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
              width={einheit === "eur" ? 64 : 36}
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
              formatter={(wert, _name, eintrag) => {
                const woche = eintrag?.payload as Woche | undefined;
                const anteile = mitAnteilen ? (woche?.anteile[feld] ?? []) : [];
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
                  titel,
                ] as [string, string];
              }}
              labelFormatter={(label, nutzlast) => {
                const woche = nutzlast?.[0]?.payload as Woche | undefined;
                return woche ? `${label} / ${woche.schluessel.slice(0, 4)}` : String(label);
              }}
            />
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
            <Bar
              dataKey={feld}
              fill="var(--ring)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function AktivitaetKarte({ von, bis }: { von: string | null; bis: string | null }) {
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
        <h2 className="text-base font-semibold">Vertriebsaktivität</h2>
        <p className="text-xs text-[var(--fg-muted)]">
          je Kalenderwoche, {fenster.von} bis {fenster.bis}
        </p>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Vertriebsaktivität konnte nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      {!fehler && daten.length === 0 && (
        <Card className="p-6 text-center text-sm text-[var(--fg-muted)]">
          {laedt
            ? "wird geladen …"
            : "Keine Kontakte, Angebote oder Interessenten in diesem Zeitraum."}
        </Card>
      )}

      {!fehler && daten.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {DIAGRAMME.map((d) => (
            <Diagramm
              key={d.feld}
              daten={daten}
              feld={d.feld}
              titel={d.titel}
              hinweis={d.hinweis}
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
