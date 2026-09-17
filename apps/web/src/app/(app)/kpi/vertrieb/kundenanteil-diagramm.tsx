"use client";

import { useMemo, useState } from "react";
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
 * dunkel #171c21). Acht Farben, mehr nicht: eine neunte wäre von einer der
 * acht nicht mehr sicher zu unterscheiden (geprüft mit dem Palettenprüfer,
 * 14 Farben fallen mit ΔE 1,0 durch). Weil der Name an jeder Zeile steht,
 * trägt die Farbe hier ohnehin nur die Wiedererkennung zwischen den beiden
 * Diagrammen.
 */
const FARBEN = `
.kundenfarben{--kf-1:#2a78d6;--kf-2:#eb6834;--kf-3:#1baf7a;--kf-4:#eda100;--kf-5:#e87ba4;--kf-6:#008300;--kf-7:#4a3aa7;--kf-8:#e34948}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .kundenfarben{--kf-1:#3987e5;--kf-2:#d95926;--kf-3:#199e70;--kf-4:#c98500;--kf-5:#d55181;--kf-6:#008300;--kf-7:#9085e9;--kf-8:#e66767}}
:root[data-theme="dark"] .kundenfarben{--kf-1:#3987e5;--kf-2:#d95926;--kf-3:#199e70;--kf-4:#c98500;--kf-5:#d55181;--kf-6:#008300;--kf-7:#9085e9;--kf-8:#e66767}
`;

/**
 * Kundenanteil als liegende Balken, ein Kunde je Zeile (VER-03B).
 *
 * Wie im Altprojekt (`CustomerShareCard.tsx`): der **Name steht an seinem
 * Balken**, nicht in einer Legende daneben. Vorher waren es senkrechte Säulen
 * mit Nummern und einer Legende — bei aufgeklappten vierzehn Kunden trugen
 * ab dem neunten alle denselben Grauton, weil es nur acht unterscheidbare
 * Farben gibt, und die Legende war der Reihe nach nicht mehr zuzuordnen.
 * Steht der Name in der Zeile, ist die Zuordnung unabhängig von der Farbe.
 *
 * Der Anteil steht rechts, der Betrag am Balken; der breiteste Balken füllt
 * die Zeile, die übrigen im Verhältnis dazu — so bleiben auch kleine Anteile
 * sichtbar.
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
  const groesster = saeulen.reduce((m, s) => Math.max(m, s.wert), 0);

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
          <ol className="mt-3 space-y-2">
            {saeulen.map((s) => (
              <li key={s.platz ?? "rest"} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                <span className="min-w-0 truncate text-xs" title={name(s)}>
                  {name(s)}
                </span>
                {/* Nur der Anteil steht in der Zeile; der Betrag hängt am
                    Balken (Titel), wie vorher im Tooltip. */}
                <span className="text-xs tabular-nums text-[var(--fg-muted)]">
                  {fmt.prozent(s.anteil)}
                </span>
                {/* Der Balken steht unter dem Namen und über die ganze Breite:
                    so bleibt der Name lesbar, auch auf dem Telefon. */}
                <span
                  // Eckig, wie alle Balken der Plattform (#107).
                  className="col-span-2 mt-1 block h-2 bg-[var(--muted)]"
                  data-balken
                  title={`${name(s)}: ${fmt.eur(s.wert)}`}
                >
                  <span
                    className="block h-full"
                    style={{
                      background: farbe(s),
                      width: `${groesster > 0 ? Math.max((s.wert / groesster) * 100, 1) : 0}%`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ol>

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
