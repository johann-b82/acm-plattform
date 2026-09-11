"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";


import { personalApi, personalKeys } from "@/lib/kpi/personal";
import { Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";

/**
 * Wochenbericht — Saldo Mehrarbeit und Krankheit je Person und Woche.
 *
 * Der einzige Teil des Personalmoduls mit Namen neben Stunden. Die
 * SQL-Funktion prüft `hr:admin` selbst und gibt sonst keine Zeilen zurück;
 * dieser Abschnitt wird zusätzlich gar nicht erst gerendert. Die Oberfläche
 * blendet damit nur aus, was die Datenbank ohnehin verweigert.
 *
 * Zwei Dinge, die man beim Lesen der Zahlen wissen muss und die deshalb
 * dranstehen:
 *
 *  * Das Soll ist das **effektive** Wochensoll — Urlaub und Krankheit sind
 *    abgezogen. Wer unentschuldigt fehlt, steht im Minus.
 *  * In der laufenden Woche zählt das Soll nur bis zum letzten gestempelten
 *    Tag. Sonst stünde jede noch nicht fertig abgeglichene Woche im Minus.
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

export function Wochenbericht() {
  const wochen = useQuery({
    queryKey: personalKeys.wochen(),
    queryFn: () => personalApi.wochenMitDaten(26),
  });

  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [einheit, setEinheit] = useState<Einheit>("stunden");

  // Vorgabe: die jüngste Woche mit Daten, sonst die laufende.
  const aktuell = useMemo(() => {
    if (gewaehlt) {
      const [j, w] = gewaehlt.split("-").map(Number);
      return { jahr: j, woche: w };
    }
    const erste = wochen.data?.[0];
    return erste ? { jahr: erste.iso_jahr, woche: erste.iso_woche } : isoWocheHeute();
  }, [gewaehlt, wochen.data]);

  const bericht = useQuery({
    queryKey: personalKeys.woche(aktuell.jahr, aktuell.woche),
    queryFn: () => personalApi.wochenbericht(aktuell.jahr, aktuell.woche),
    enabled: wochen.isSuccess,
  });

  const zeilen = bericht.data ?? [];
  const saldo = zeilen.reduce((s, z) => s + z.netto, 0);
  const krankTage = zeilen.reduce((s, z) => s + z.krank_tage, 0);
  const krankStunden = zeilen.reduce((s, z) => s + z.krank_stunden, 0);
  const ueberstunden = zeilen.filter((z) => z.netto > 0.01);

  const worte = useTexte();
  const fmt = useFormate();
  const fehler = wochen.error ?? bericht.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{worte.wochenbericht.titel}</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="woche" className="text-xs text-[var(--fg-muted)]">
            {worte.wochenbericht.kalenderwoche}
          </label>
          <select
            id="woche"
            value={`${aktuell.jahr}-${aktuell.woche}`}
            onChange={(e) => setGewaehlt(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          >
            {(wochen.data ?? []).map((w) => (
              <option key={`${w.iso_jahr}-${w.iso_woche}`} value={`${w.iso_jahr}-${w.iso_woche}`}>
                {worte.wochenbericht.kw(String(w.iso_woche).padStart(2, "0"), String(w.iso_jahr))}
              </option>
            ))}
          </select>
        </div>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {worte.wochenbericht.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      {!fehler && !bericht.isLoading && zeilen.length === 0 && (
        <Card className="p-6 text-center text-sm text-[var(--fg-muted)]">
          {worte.wochenbericht.keineDaten}
        </Card>
      )}

      {zeilen.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <div className="text-sm text-[var(--fg-muted)]">{worte.wochenbericht.saldo}</div>
              <div
                className={cn(
                  "mt-1 font-mono text-2xl font-medium tabular-nums",
                  saldo < 0 && "text-[var(--danger)]",
                )}
              >
                {saldo > 0 ? "+" : ""}
                {saldo.toFixed(2)} {worte.wochenbericht.stunden}
              </div>
              <div className="mt-1 text-xs text-[var(--fg-muted)]">
                {worte.wochenbericht.saldoHinweis(String(zeilen.length))}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-[var(--fg-muted)]">{worte.wochenbericht.ueberSoll}</div>
              <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
                {fmt.zahl(ueberstunden.length)}
              </div>
              <div className="mt-1 text-xs text-[var(--fg-muted)]">
                {worte.wochenbericht.ueberSollHinweis(String(zeilen.length))}
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-baseline justify-between">
                <div className="text-sm text-[var(--fg-muted)]">{worte.wochenbericht.krankheit}</div>
                <div className="flex gap-1 text-xs">
                  {(["tage", "stunden"] as Einheit[]).map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEinheit(e)}
                      aria-pressed={einheit === e}
                      className={cn(
                        "rounded px-1.5 py-0.5",
                        einheit === e
                          ? "bg-[var(--fg)] text-[var(--bg)]"
                          : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
                      )}
                    >
                      {e === "tage" ? worte.wochenbericht.tage : worte.wochenbericht.stunden}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
                {einheit === "tage" ? krankTage.toFixed(2) : krankStunden.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-[var(--fg-muted)]">
                {worte.wochenbericht.krankheitHinweis}
              </div>
            </Card>
          </div>

          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{worte.mitarbeiter.person}</Th>
                  <Th className="text-right">{worte.wochenbericht.ist}</Th>
                  <Th className="text-right">{worte.wochenbericht.soll}</Th>
                  <Th className="text-right">{worte.wochenbericht.saldoSpalte}</Th>
                  <Th className="text-right">{worte.wochenbericht.krankheit}</Th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.employee_id}>
                    <Td>{z.name ?? `#${z.employee_id}`}</Td>
                    <Td className="text-right font-mono tabular-nums">
                      {z.ist_stunden.toFixed(2)}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">
                      {z.soll_stunden.toFixed(2)}
                    </Td>
                    <Td
                      className={cn(
                        "text-right font-mono tabular-nums",
                        z.netto < -0.01 && "text-[var(--danger)]",
                      )}
                    >
                      {z.netto > 0 ? "+" : ""}
                      {z.netto.toFixed(2)}
                    </Td>
                    <Td className="text-right font-mono tabular-nums text-[var(--fg-muted)]">
                      {einheit === "tage"
                        ? z.krank_tage > 0
                          ? z.krank_tage.toFixed(2)
                          : "—"
                        : z.krank_stunden > 0
                          ? z.krank_stunden.toFixed(2)
                          : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>

          <p className="text-xs text-[var(--fg-muted)]">
            {worte.wochenbericht.fussnote}
          </p>
        </>
      )}
    </section>
  );
}
