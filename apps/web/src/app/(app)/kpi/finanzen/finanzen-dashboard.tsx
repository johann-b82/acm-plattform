"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { takt } from "@/lib/kpi/gemeinsam";
import {
  finanzenApi,
  type PersonalkostenAbteilung,
  type VerbrauchZeile,
} from "@/lib/kpi/finanzen";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Card } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl, type Zeitraumwahl as Wahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { DiagrammartWahl, useDiagrammart } from "@/components/kpi/diagrammart";
import { Seitenkopf } from "@/components/seitenkopf";
import { useInSchale } from "@/components/sidebar/werkzeugplatz";
import { Leistenwahl } from "@/components/sidebar/leistenwahl";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { cn } from "@/lib/cn";

type Ansicht = "material" | "personal";

/**
 * Finanzen, getrennt in Material und Personal (FIN-04) wie im Altsystem.
 *
 * Der Umschalter steht links auf Höhe der Zeitraumwahl. Die Zeitraumwahl
 * gehört der Seite, nicht der Ansicht — ein Wechsel behält den Zeitraum. Jede
 * Ansicht ist eine eigene Komponente, damit nur ihre Abfragen laufen.
 */
export function FinanzenDashboard() {
  const worte = useTexte();
  const wahl = useZeitraumwahl();
  const [ansicht, setAnsicht] = useState<Ansicht>("material");

  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const zielNach = nachSchluessel(ziele.data ?? []);

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.finanzen.einleitung}
        links={
          // Kein eigener Titel: er stünde gleich unter der Kategorie „Ansicht“.
          <AnsichtWahl ansicht={ansicht} onChange={setAnsicht} />
        }
        bedienung={
          <>
            <Zeitraumwahl wahl={wahl} datenstand={<Datenstand bereich="finanzen" />} />
          </>
        }
      />

      {ansicht === "material" ? (
        <MaterialAnsicht
          wahl={wahl}
          ziel={zielNach["finanzen_materialkostenquote"]}
          zieleFehler={ziele.error}
        />
      ) : (
        <PersonalAnsicht
          wahl={wahl}
          ziel={zielNach["finanzen_personalkostenquote"]}
          zieleFehler={ziele.error}
        />
      )}
    </div>
  );
}

function AnsichtWahl({ ansicht, onChange }: { ansicht: Ansicht; onChange: (a: Ansicht) => void }) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const stufen: [Ansicht, string][] = [
    ["material", worte.finanzen.ansichtMaterial],
    ["personal", worte.finanzen.ansichtPersonal],
  ];
  // In der schmalen Leiste eine Auswahlliste; die Knöpfe brächen dort um.
  if (inSchale) {
    return <Leistenwahl beschriftung={worte.finanzen.ansicht} wert={ansicht} onChange={onChange} optionen={stufen} />;
  }
  return (
    <div
      role="radiogroup"
      aria-label={worte.finanzen.ansicht}
      className="inline-flex h-9 items-center rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      {stufen.map(([wert, name]) => (
        <button
          key={wert}
          type="button"
          role="radio"
          aria-checked={ansicht === wert}
          onClick={() => onChange(wert)}
          className={cn(
            "h-full rounded px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
            ansicht === wert
              ? "bg-[var(--muted)] font-medium text-[var(--fg)]"
              : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function Fehlerkarte({ fehler }: { fehler: unknown }) {
  const worte = useTexte();
  if (!fehler) return null;
  return (
    <Card className="p-4 text-sm text-[var(--danger)]">
      {worte.dashboard.ladeFehler((fehler as Error).message)}
    </Card>
  );
}

function MaterialAnsicht({ wahl, ziel, zieleFehler }: { wahl: Wahl; ziel: number | undefined; zieleFehler: unknown }) {
  const worte = useTexte();
  const fmt = useFormate();
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
  const vgl = useVergleich(["kpi", "finanzen", "material"], zeitraum, von, bis, finanzenApi.materialkosten);

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

  const spalten = useMemo<Tabellenspalte<VerbrauchZeile>[]>(
    () => [
      {
        schluessel: "artikel",
        titel: worte.finanzen.artikel,
        typ: "text",
        wert: (z) => z.artikelnr,
        zelle: (z) => <span className="font-mono text-xs">{z.artikelnr}</span>,
      },
      {
        schluessel: "bezeichnung",
        titel: worte.finanzen.bezeichnung,
        typ: "text",
        wert: (z) => z.article_name,
        zelle: (z) => <span className="block max-w-sm truncate">{z.article_name ?? "—"}</span>,
      },
      {
        schluessel: "menge",
        titel: worte.finanzen.menge,
        typ: "zahl",
        wert: (z) => z.menge,
        zelle: (z) => fmt.zahl(z.menge),
        ausrichtung: "end",
      },
      {
        schluessel: "stueckpreis",
        titel: worte.finanzen.stueckpreis,
        typ: "zahl",
        wert: (z) => z.stueckpreis,
        zelle: (z) =>
          z.stueckpreis == null ? (
            <span className="text-[var(--danger)]">{worte.finanzen.keinPreis}</span>
          ) : (
            fmt.eurGenau(z.stueckpreis)
          ),
        ausrichtung: "end",
      },
      {
        schluessel: "kosten",
        titel: worte.finanzen.kosten,
        typ: "zahl",
        wert: (z) => z.kosten,
        zelle: (z) => fmt.eur(z.kosten),
        ausrichtung: "end",
      },
    ],
    [worte, fmt],
  );

  const zeilen = verbrauch.data;
  const keineDaten = !summe.isLoading && summe.data?.materialkosten === 0 && summe.data?.umsatz === 0;
  const fehler = summe.error ?? verlauf.error ?? verbrauch.error ?? zieleFehler;

  return (
    <>
      <Fehlerkarte fehler={fehler} />

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kennzahl
          titel={worte.finanzen.materialquote}
          erklaerung={{ seite: "finanzen", abschnitt: "Materialkostenquote" }}
          wert={fmt.prozent(summe.data?.quote)}
          hinweis={ziel == null ? worte.finanzen.materialquoteHinweis : worte.finanzen.hoechstens(fmt.prozent(ziel))}
          warnung={ziel != null && summe.data?.quote != null && summe.data.quote > ziel}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.quote}
              vorperiode={vgl.vorperiode?.quote}
              vorjahr={vgl.vorjahr?.quote}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
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
              vorperiode={vgl.vorperiode?.umsatz}
              vorjahr={vgl.vorjahr?.umsatz}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
              richtung="mehr_ist_besser"
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

      {chartDaten.length > 0 && (
        <QuotenVerlauf titel={worte.finanzen.verlauf} daten={chartDaten} ziel={ziel} />
      )}

      {zeilen && zeilen.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.finanzen.verbrauch}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">{worte.finanzen.verbrauchHinweis}</p>
          <div className="mt-4">
            <Datentabelle
              beschriftung={worte.finanzen.verbrauch}
              zeilen={zeilen}
              spalten={spalten}
              zeilenSchluessel={(z) => z.artikelnr}
              vorsortierung={{ spalte: "kosten", richtung: "ab" }}
            />
          </div>
        </Card>
      )}
    </>
  );
}

function PersonalAnsicht({ wahl, ziel, zieleFehler }: { wahl: Wahl; ziel: number | undefined; zieleFehler: unknown }) {
  const worte = useTexte();
  const fmt = useFormate();
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);

  // Die Personalkostenquote verteilt Monatsbrutto anteilig — ohne Fenster
  // ergibt das nichts. Beim Zeitraum „Alles" bleibt sie deshalb aus (E-03).
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
  const verlauf = useQuery({
    queryKey: ["kpi", "finanzen", "personal-verlauf", von, bis],
    queryFn: () => finanzenApi.personalVerlauf(von!, bis!),
    enabled: hatFenster,
  });
  const vgl = useVergleich(["kpi", "finanzen", "personal"], zeitraum, von, bis, finanzenApi.personalkosten);

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      (verlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        quote: p.quote == null ? null : p.quote * 100,
        kosten: p.personalkosten,
      })),
    [verlaufDaten, t, fmt],
  );

  const gesamt = personal.data?.personalkosten ?? 0;
  const spalten = useMemo<Tabellenspalte<PersonalkostenAbteilung>[]>(
    () => [
      { schluessel: "abteilung", titel: worte.finanzen.abteilung, typ: "text", wert: (z) => z.abteilung },
      {
        schluessel: "personen",
        titel: worte.finanzen.personen,
        typ: "zahl",
        wert: (z) => z.personen,
        zelle: (z) => fmt.zahl(z.personen),
        ausrichtung: "end",
      },
      {
        schluessel: "kosten",
        titel: worte.finanzen.kosten,
        typ: "zahl",
        wert: (z) => z.kosten,
        zelle: (z) => fmt.eur(z.kosten),
        ausrichtung: "end",
      },
      {
        schluessel: "anteil",
        titel: worte.finanzen.anteil,
        typ: "zahl",
        wert: (z) => (gesamt > 0 ? z.kosten / gesamt : null),
        zelle: (z) => (gesamt > 0 ? fmt.prozent(z.kosten / gesamt) : "—"),
        ausrichtung: "end",
      },
    ],
    [worte, fmt, gesamt],
  );

  const ohneFenster = hatFenster ? undefined : worte.finanzen.brauchtZeitraum;
  const zeilen = jeAbteilung.data;
  const fehler = personal.error ?? jeAbteilung.error ?? verlauf.error ?? zieleFehler;

  return (
    <>
      <Fehlerkarte fehler={fehler} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kennzahl
          titel={worte.finanzen.personalquote}
          erklaerung={{ seite: "finanzen", abschnitt: "Personalkostenquote" }}
          wert={hatFenster ? fmt.prozent(personal.data?.quote) : "—"}
          hinweis={
            ohneFenster ??
            (ziel == null ? worte.finanzen.personalquoteHinweis : worte.finanzen.hoechstens(fmt.prozent(ziel)))
          }
          warnung={ziel != null && personal.data?.quote != null && personal.data.quote > ziel}
          laedt={personal.isLoading}
          vergleich={
            <Vergleiche
              aktuell={personal.data?.quote}
              vorperiode={vgl.vorperiode?.quote}
              vorjahr={vgl.vorjahr?.quote}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.finanzen.personalkosten}
          erklaerung={{ seite: "finanzen", abschnitt: "Personalkostenquote" }}
          wert={hatFenster ? fmt.eur(personal.data?.personalkosten) : "—"}
          hinweis={ohneFenster}
          laedt={personal.isLoading}
        />
        <Kennzahl
          titel={worte.finanzen.umsatz}
          erklaerung={{ seite: "finanzen", abschnitt: "Personalkostenquote" }}
          wert={hatFenster ? fmt.eur(personal.data?.umsatz) : "—"}
          hinweis={ohneFenster}
          laedt={personal.isLoading}
          vergleich={
            <Vergleiche
              aktuell={personal.data?.umsatz}
              vorperiode={vgl.vorperiode?.umsatz}
              vorjahr={vgl.vorjahr?.umsatz}
              vorperiodeLabel={vgl.label}
              vorjahrLabel={vgl.labelVorjahr}
              richtung="mehr_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.finanzen.mitarbeiter}
          erklaerung={{ seite: "finanzen", abschnitt: "Personalkostenquote" }}
          wert={hatFenster ? fmt.zahl(personal.data?.personen) : "—"}
          hinweis={ohneFenster ?? worte.finanzen.mitarbeiterHinweis}
          laedt={personal.isLoading}
        />
      </div>

      {hatFenster && chartDaten.length > 0 && (
        <QuotenVerlauf
          titel={worte.finanzen.personalVerlauf}
          hinweis={worte.finanzen.verlaufHinweis}
          daten={chartDaten}
          ziel={ziel}
        />
      )}

      {hatFenster && zeilen && zeilen.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.finanzen.jeAbteilung}</h2>
          <div className="mt-4">
            <Datentabelle
              beschriftung={worte.finanzen.jeAbteilung}
              zeilen={zeilen}
              spalten={spalten}
              zeilenSchluessel={(z) => z.abteilung}
              vorsortierung={{ spalte: "kosten", richtung: "ab" }}
            />
          </div>
        </Card>
      )}
    </>
  );
}

/** Quote je Takt, als Balken oder Fläche (VER-04B). Lücken bleiben Lücken. */
function QuotenVerlauf({
  titel,
  hinweis,
  daten,
  ziel,
}: {
  titel: string;
  hinweis?: string;
  daten: { label: string; quote: number | null; kosten: number }[];
  ziel: number | undefined;
}) {
  const worte = useTexte();
  const fmt = useFormate();
  const [art, setArt] = useDiagrammart();
  const farbe = "var(--accent, #2f6f8f)";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{titel}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">{hinweis ?? worte.finanzen.verlaufHinweis}</p>
        </div>
        <DiagrammartWahl art={art} onChange={setArt} />
      </div>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          {/* Rechter Rand trägt die Beschriftung der Ziellinie. */}
          <ComposedChart data={daten} margin={{ top: 8, right: 56, bottom: 0, left: 8 }}>
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
                  worte.finanzen.quoteBeiKosten(fmt.eur(kosten)),
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
            {art === "balken" ? (
              <Bar dataKey="quote" fill={farbe} isAnimationActive={false} />
            ) : (
              <Area
                type="monotone"
                dataKey="quote"
                stroke={farbe}
                strokeWidth={2}
                fill={farbe}
                fillOpacity={0.2}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
