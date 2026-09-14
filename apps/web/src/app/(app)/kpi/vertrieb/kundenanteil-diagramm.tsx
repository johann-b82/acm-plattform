"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";

import { kundensaeulen, type KundenAnteil, type Kundensaeule } from "@/lib/kpi/vertrieb";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { Card } from "@/components/ui/primitives";

/** Wie `CustomerShareCard.tsx`: zuerst die drei größten, aufklappbar bis 14. */
const OBEN = 3;
const HOECHSTENS = 14;

/**
 * Kategorienpalette, auf den Flächen der Plattform geprüft (hell #ffffff,
 * dunkel #171c21). Drei helle Töne liegen unter 3:1 zur Fläche — deshalb
 * trägt jede Säule ihre Nummer und ihren Anteil als Text.
 */
const FARBEN = `
.kundenfarben{--kf-1:#2a78d6;--kf-2:#eb6834;--kf-3:#1baf7a;--kf-4:#eda100;--kf-5:#e87ba4;--kf-6:#008300;--kf-7:#4a3aa7;--kf-8:#e34948}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .kundenfarben{--kf-1:#3987e5;--kf-2:#d95926;--kf-3:#199e70;--kf-4:#c98500;--kf-5:#d55181;--kf-6:#008300;--kf-7:#9085e9;--kf-8:#e66767}}
:root[data-theme="dark"] .kundenfarben{--kf-1:#3987e5;--kf-2:#d95926;--kf-3:#199e70;--kf-4:#c98500;--kf-5:#d55181;--kf-6:#008300;--kf-7:#9085e9;--kf-8:#e66767}
`;

/**
 * Kundenanteil als senkrechte Säulen (VER-03B).
 *
 * Absteigend von links, gemeinsame Nulllinie, Prozent über jeder Säule.
 * Namen und Beträge stehen in der Legende rechts — lange Kundennamen passen
 * nicht unter eine Säule —, bei wenig Platz darunter. Säule und Legende
 * tragen dieselbe Nummer; die Farbe kommt dazu und ist je Kunde in beiden
 * Diagrammen gleich (`kundenfarben`).
 *
 * Der Wasserfall der Referenz ist bewusst ersetzt; Rechnung, Top 3/14 und
 * Rest sind dieselben.
 */
export function KundenanteilDiagramm({
  titel,
  hinweis,
  kunden,
  laedt,
  farben,
}: {
  titel: string;
  hinweis: string;
  kunden: readonly KundenAnteil[] | undefined;
  laedt: boolean;
  farben: Map<string, number>;
}) {
  const worte = useTexte();
  const fmt = useFormate();
  const [offen, setOffen] = useState(false);

  const alle = kunden ?? [];
  const { saeulen, restAnzahl } = useMemo(
    () => kundensaeulen(kunden ?? [], offen ? HOECHSTENS : OBEN),
    [kunden, offen],
  );
  const daten = saeulen.map((s) => ({ ...s, achse: s.platz === null ? worte.vertrieb.rest : String(s.platz) }));

  const farbe = (s: Kundensaeule) => {
    if (s.platz === null) return "color-mix(in oklab, var(--fg-muted) 45%, var(--surface))";
    const f = farben.get(s.kunde);
    return f === undefined ? "var(--fg-muted)" : `var(--kf-${f + 1})`;
  };
  const name = (s: Kundensaeule) => (s.platz === null ? worte.vertrieb.restkunden(restAnzahl) : s.kunde);

  return (
    <Card className="kundenfarben p-4">
      <style>{FARBEN}</style>
      <h2 className="text-base font-semibold">{titel}</h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">{hinweis}</p>

      {saeulen.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--fg-muted)]">
          {laedt ? worte.dashboard.laedt : worte.dashboard.keineWerte}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-4 md:flex-row">
            <div className="h-56 min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daten} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
                  <XAxis
                    dataKey="achse"
                    stroke="var(--fg-muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    interval={0}
                  />
                  <YAxis hide />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--fg)",
                    }}
                    labelFormatter={(_label, nutzlast) => {
                      const s = nutzlast?.[0]?.payload as Kundensaeule | undefined;
                      return s ? name(s) : "";
                    }}
                    formatter={(wert, _name, eintrag) => {
                      const s = eintrag?.payload as Kundensaeule;
                      return [`${fmt.eur(Number(wert))} · ${fmt.prozent(s.anteil)}`, titel] as [string, string];
                    }}
                  />
                  <Bar dataKey="wert" maxBarSize={48} isAnimationActive={false}>
                    {daten.map((s) => (
                      <Cell key={s.achse} fill={farbe(s)} />
                    ))}
                    <LabelList
                      dataKey="anteil"
                      position="top"
                      fontSize={10}
                      fill="var(--fg)"
                      formatter={(v: unknown) => fmt.prozent(Number(v))}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <ol className="space-y-1 text-xs md:w-72 md:shrink-0">
              {saeulen.map((s) => (
                <li key={s.platz ?? "rest"} className="flex items-baseline gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 self-center rounded-sm" style={{ background: farbe(s) }} />
                  <span className="w-7 shrink-0 tabular-nums text-[var(--fg-muted)]">
                    {s.platz === null ? worte.vertrieb.rest : `${s.platz}.`}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{name(s)}</span>
                  <span className="shrink-0 font-mono tabular-nums">{fmt.eur(s.wert)}</span>
                </li>
              ))}
            </ol>
          </div>

          {alle.length > OBEN && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                aria-expanded={offen}
                onClick={() => setOffen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              >
                {offen ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                    {worte.vertrieb.nurTop3}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    {worte.vertrieb.weitereKunden(Math.min(alle.length - OBEN, HOECHSTENS - OBEN))}
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
