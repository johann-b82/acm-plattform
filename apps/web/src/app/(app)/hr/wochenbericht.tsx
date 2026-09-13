"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { personalApi, personalKeys, spitze, type WochenZeile } from "@/lib/kpi/personal";
import { pdfTexte, wochenberichtPdf } from "@/lib/kpi/wochenbericht-pdf";
import { Button, Card, Select } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { cn } from "@/lib/cn";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { ZAHL_TAG } from "@/lib/sprache";

/**
 * Wochenbericht — Saldo Mehrarbeit und Krankheit je Person und Woche.
 *
 * Der einzige Teil des Personalmoduls mit Namen neben Stunden. Die
 * SQL-Funktion prüft `hr:admin` selbst und gibt sonst keine Zeilen zurück;
 * dieser Abschnitt wird zusätzlich gar nicht erst gerendert. Die Oberfläche
 * blendet damit nur aus, was die Datenbank ohnehin verweigert. Das PDF setzt
 * sich aus denselben Zeilen zusammen und hat damit dasselbe Recht.
 *
 * Zwei Dinge, die man beim Lesen der Zahlen wissen muss und die deshalb
 * dranstehen:
 *
 *  * Das Soll ist das **effektive** Wochensoll — Urlaub und Krankheit sind
 *    abgezogen. Wer unentschuldigt fehlt, steht im Minus.
 *  * In der laufenden Woche zählt das Soll nur bis zum letzten gestempelten
 *    Tag. Sonst stünde jede noch nicht fertig abgeglichene Woche im Minus.
 *
 * Die beiden Diagramme zeigen wie im Altsystem die fünf Personen mit der
 * meisten Mehrarbeit und der meisten Krankheit der Woche — keine Zeitachse,
 * deshalb ohne Balken/Fläche-Umschaltung. Alle Personen stehen in der Tabelle.
 */

type Einheit = "tage" | "stunden";

function isoWocheHeute(): { jahr: number; woche: number } {
  // ISO-Woche: Donnerstag der laufenden Woche entscheidet über das Jahr.
  const heute = new Date();
  const d = new Date(Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jahresanfang = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const woche = Math.ceil(((d.getTime() - jahresanfang.getTime()) / 86_400_000 + 1) / 7);
  return { jahr: d.getUTCFullYear(), woche };
}

function Personendiagramm({
  titel,
  hinweis,
  personen,
  einheit,
  leer,
}: {
  titel: string;
  hinweis: string;
  personen: { name: string; wert: number }[];
  einheit: string;
  leer: string;
}) {
  const daten = personen.map((p) => ({ ...p, beschriftung: p.wert.toFixed(2) }));
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{titel}</h3>
      <p className="mt-0.5 truncate text-xs text-[var(--fg-muted)]">{hinweis}</p>
      <div className="mt-3 h-56">
        {daten.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--fg-muted)]">{leer}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daten} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                stroke="var(--fg-muted)"
                fontSize={12}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                stroke="var(--fg-muted)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--fg)",
                }}
                formatter={(wert) => [`${Number(wert).toFixed(2)} ${einheit}`, titel] as [string, string]}
              />
              <Bar dataKey="wert" fill="var(--ring)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList dataKey="beschriftung" position="right" fontSize={11} fill="var(--fg-muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export function Wochenbericht() {
  const worte = useTexte();
  const w = worte.wochenbericht;
  const fmt = useFormate();
  const sprache = useSprache();
  const wocheId = useId();

  const wochen = useQuery({
    queryKey: personalKeys.wochen(),
    queryFn: () => personalApi.wochenMitDaten(26),
  });

  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [einheit, setEinheit] = useState<Einheit>("stunden");
  const [pdfLaeuft, setPdfLaeuft] = useState(false);

  // Vorgabe: die jüngste Woche mit Daten, sonst die laufende.
  const aktuell = useMemo(() => {
    if (gewaehlt) {
      const [j, wo] = gewaehlt.split("-").map(Number);
      return { jahr: j, woche: wo };
    }
    const erste = wochen.data?.[0];
    return erste ? { jahr: erste.iso_jahr, woche: erste.iso_woche } : isoWocheHeute();
  }, [gewaehlt, wochen.data]);

  const bericht = useQuery({
    queryKey: personalKeys.woche(aktuell.jahr, aktuell.woche),
    queryFn: () => personalApi.wochenbericht(aktuell.jahr, aktuell.woche),
    enabled: wochen.isSuccess,
  });

  const zeilen = useMemo(() => bericht.data ?? [], [bericht.data]);
  const saldo = zeilen.reduce((s, z) => s + z.netto, 0);
  const krank = (z: WochenZeile) => (einheit === "tage" ? z.krank_tage : z.krank_stunden);
  const krankSumme = zeilen.reduce((s, z) => s + krank(z), 0);
  const ueberSoll = zeilen.filter((z) => z.netto > 0.01).length;
  const einheitText = einheit === "tage" ? w.tage : w.stunden;
  const fehler = wochen.error ?? bericht.error;

  const spalten = useMemo<Tabellenspalte<WochenZeile>[]>(() => {
    const krankWert = (z: WochenZeile) => (einheit === "tage" ? z.krank_tage : z.krank_stunden);
    return [
      { schluessel: "name", titel: worte.mitarbeiter.person, typ: "text", wert: (z) => z.name ?? `#${z.employee_id}` },
      {
        schluessel: "ist",
        titel: w.ist,
        typ: "zahl",
        ausrichtung: "end",
        wert: (z) => z.ist_stunden,
        zelle: (z) => z.ist_stunden.toFixed(2),
        className: "font-mono",
      },
      {
        schluessel: "soll",
        titel: w.soll,
        typ: "zahl",
        ausrichtung: "end",
        wert: (z) => z.soll_stunden,
        zelle: (z) => z.soll_stunden.toFixed(2),
        className: "font-mono",
      },
      {
        schluessel: "saldo",
        titel: w.saldoSpalte,
        typ: "zahl",
        ausrichtung: "end",
        wert: (z) => z.netto,
        zelle: (z) => (
          <span className={cn(z.netto < -0.01 && "text-[var(--danger)]")}>
            {z.netto > 0 ? "+" : ""}
            {z.netto.toFixed(2)}
          </span>
        ),
        className: "font-mono",
      },
      {
        schluessel: "krankheit",
        titel: `${w.krankheit} (${einheit === "tage" ? w.tage : w.stunden})`,
        typ: "zahl",
        ausrichtung: "end",
        wert: krankWert,
        zelle: (z) => (krankWert(z) > 0 ? krankWert(z).toFixed(2) : "—"),
        className: "font-mono text-[var(--fg-muted)]",
      },
    ];
  }, [w, worte.mitarbeiter.person, einheit]);

  async function alsPdf() {
    setPdfLaeuft(true);
    try {
      const texte = pdfTexte(worte);
      const dok = await wochenberichtPdf(
        { jahr: aktuell.jahr, woche: aktuell.woche, einheit, zeilen, erstellt: new Date() },
        texte,
        texte === worte ? ZAHL_TAG[sprache] : ZAHL_TAG.de,
      );
      dok.save(`Wochenbericht_KW${String(aktuell.woche).padStart(2, "0")}_${aktuell.jahr}.pdf`);
    } finally {
      setPdfLaeuft(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{w.titel}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label={w.einheit}
            className="inline-flex rounded-md border border-[var(--border)] p-0.5"
          >
            {(["tage", "stunden"] as Einheit[]).map((e) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={einheit === e}
                onClick={() => setEinheit(e)}
                className={cn(
                  "rounded px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
                  einheit === e
                    ? "bg-[var(--muted)] font-medium text-[var(--fg)]"
                    : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
                )}
              >
                {e === "tage" ? w.tage : w.stunden}
              </button>
            ))}
          </div>
          <label htmlFor={wocheId} className="text-xs text-[var(--fg-muted)]">
            {w.kalenderwoche}
          </label>
          <Select
            id={wocheId}
            value={`${aktuell.jahr}-${aktuell.woche}`}
            onChange={(e) => setGewaehlt(e.target.value)}
            className="w-36"
          >
            {(wochen.data ?? []).map((x) => (
              <option key={`${x.iso_jahr}-${x.iso_woche}`} value={`${x.iso_jahr}-${x.iso_woche}`}>
                {w.kw(String(x.iso_woche).padStart(2, "0"), String(x.iso_jahr))}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={alsPdf}
            disabled={pdfLaeuft || zeilen.length === 0}
          >
            <FileDown className="h-4 w-4" aria-hidden />
            {pdfLaeuft ? w.pdfLaeuft : w.pdf}
          </Button>
        </div>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {w.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      {!fehler && !bericht.isLoading && zeilen.length === 0 && (
        <Card className="p-6 text-center text-sm text-[var(--fg-muted)]">{w.keineDaten}</Card>
      )}

      {zeilen.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kennzahl
              titel={w.saldo}
              wert={`${saldo > 0 ? "+" : ""}${saldo.toFixed(2)} ${w.stunden}`}
              hinweis={w.saldoHinweis(String(zeilen.length))}
              warnung={saldo < 0}
              laedt={false}
            />
            <Kennzahl
              titel={w.ueberSoll}
              wert={fmt.zahl(ueberSoll)}
              hinweis={w.ueberSollHinweis(String(zeilen.length))}
              laedt={false}
            />
            <Kennzahl
              titel={w.krankheit}
              wert={`${krankSumme.toFixed(2)} ${einheitText}`}
              hinweis={w.krankheitHinweis}
              laedt={false}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Personendiagramm
              titel={w.diagrammUeberstunden}
              hinweis={w.spitzeHinweis}
              personen={spitze(zeilen, (z) => z.netto)}
              einheit={w.stunden}
              leer={w.keineWerte}
            />
            <Personendiagramm
              titel={w.diagrammKrankheit}
              hinweis={w.spitzeHinweis}
              personen={spitze(zeilen, krank)}
              einheit={einheitText}
              leer={w.keineWerte}
            />
          </div>

          <Datentabelle
            zeilen={zeilen}
            spalten={spalten}
            zeilenSchluessel={(z) => z.employee_id}
            vorsortierung={{ spalte: "saldo", richtung: "ab" }}
            beschriftung={w.titel}
          />

          <p className="text-xs text-[var(--fg-muted)]">{w.fussnote}</p>
        </>
      )}
    </section>
  );
}
