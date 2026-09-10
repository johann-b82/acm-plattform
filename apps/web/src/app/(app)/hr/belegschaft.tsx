"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { fmt } from "@/lib/kpi/gemeinsam";
import { personalApi, personalKeys, prozente } from "@/lib/kpi/personal";
import { Card } from "@/components/ui/primitives";

/**
 * Belegschaft und Kompetenzentwicklung — beides Stichtagswerte.
 *
 * Der Zeitraumwähler der Seite gilt hier nicht: „wie viele sind wir" ist
 * kein Zeitraum. Angezeigt wird der heutige Stand.
 *
 * Wichtig beim Lesen und deshalb auch am Bildschirm vermerkt: die
 * Verteilungen nutzen die **heutigen** Stammdaten. Personio liefert keine
 * Historie — nur die Kopfzahl ist echt stichtagsbezogen.
 */

const LABEL: Record<string, string> = {
  maennlich: "männlich",
  weiblich: "weiblich",
  divers: "divers",
  unbekannt: "unbekannt",
  vollzeit: "Vollzeit",
  teilzeit: "Teilzeit",
  geringfuegig: "geringfügig",
  extern: "extern",
};

function Balken({
  titel,
  zeilen,
  alsProzent,
}: {
  titel: string;
  zeilen: { kategorie: string; anzahl: number }[];
  alsProzent: boolean;
}) {
  const mitAnteil = useMemo(() => prozente(zeilen), [zeilen]);
  const groesste = Math.max(1, ...zeilen.map((z) => z.anzahl));

  if (zeilen.length === 0) return null;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{titel}</h3>
      <ul className="mt-3 space-y-2">
        {mitAnteil.map((z) => (
          <li key={z.kategorie} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{LABEL[z.kategorie] ?? z.kategorie}</span>
              <span className="shrink-0 font-mono tabular-nums text-[var(--fg-muted)]">
                {alsProzent ? `${z.prozent} %` : fmt.zahl(z.anzahl)}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-[var(--muted)]">
              <div
                className="h-1.5 rounded bg-[var(--ring)]"
                style={{ width: `${(z.anzahl / groesste) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Belegschaft() {
  const kopf = useQuery({
    queryKey: personalKeys.belegschaft(),
    queryFn: () => personalApi.belegschaft(),
  });
  const verteilung = useQuery({
    queryKey: [...personalKeys.belegschaft(), "verteilung"],
    queryFn: () => personalApi.verteilung(),
  });
  const kompetenz = useQuery({
    queryKey: personalKeys.kompetenz("heute"),
    queryFn: () => personalApi.kompetenz(),
  });

  const zeilen = verteilung.data ?? [];
  const je = (art: string) =>
    zeilen.filter((z) => z.art === art).map((z) => ({ kategorie: z.kategorie, anzahl: z.anzahl }));

  const fehler = kopf.error ?? verteilung.error ?? kompetenz.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Belegschaft</h2>
        <p className="max-w-prose text-xs text-[var(--fg-muted)]">
          Stand heute. Die Verteilungen zeigen die aktuellen Stammdaten, nicht die von damals —
          Personio liefert keine Historie. Dass {"„Beschäftigte“"} und die Kompetenzquote
          verschiedene Nenner haben, ist Absicht: die eine Zahl folgt dem Personio-Status,
          die andere Ein- und Austrittsdatum. Beide Wege stammen aus dem Altprojekt.
        </p>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Belegschaft konnte nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="text-sm text-[var(--fg-muted)]">Beschäftigte</div>
          <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
            {kopf.isLoading ? "…" : fmt.zahl(kopf.data?.gesamt)}
          </div>
          <div className="mt-1 text-xs text-[var(--fg-muted)]">
            nach Personio-Status {"„aktiv“"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[var(--fg-muted)]">Neu im Quartal</div>
          <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
            {kopf.isLoading ? "…" : fmt.zahl(kopf.data?.neu)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[var(--fg-muted)]">Bestand</div>
          <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
            {kopf.isLoading ? "…" : fmt.zahl(kopf.data?.bestand)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[var(--fg-muted)]">Kompetenzen gepflegt</div>
          <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
            {kompetenz.isLoading
              ? "…"
              : kompetenz.data?.eingerichtet === false
                ? "—"
                : fmt.prozent(kompetenz.data?.quote)}
          </div>
          <div className="mt-1 text-xs text-[var(--fg-muted)]">
            {kompetenz.data?.eingerichtet === false ? (
              <>
                Felder nicht hinterlegt —{" "}
                <Link href="/einstellungen" className="underline underline-offset-4">
                  Einstellungen
                </Link>
              </>
            ) : (
              `${fmt.zahl(kompetenz.data?.mit_kompetenz)} von ${fmt.zahl(kompetenz.data?.aktive)} nach Ein- und Austritt`
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Balken titel="Geschlecht" zeilen={je("geschlecht")} alsProzent />
        <Balken titel="Beschäftigungsart" zeilen={je("beschaeftigung")} alsProzent={false} />
        <Balken titel="Abteilungen" zeilen={je("abteilung")} alsProzent={false} />
      </div>
    </section>
  );
}
