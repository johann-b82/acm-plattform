"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";


import {
  personalApi,
  personalKeys,
  prozente,
} from "@/lib/kpi/personal";
import { Card } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";

/**
 * Belegschaft und Kompetenzentwicklung — beides Stichtagswerte.
 *
 * Der Zeitraumwähler der Seite gilt hier nicht: „wie viele sind wir" ist
 * kein Zeitraum. Angezeigt wird der heutige Stand — ohne Vergleichszeilen,
 * weil es keinen historischen Stand gibt, gegen den verglichen werden könnte.
 *
 * Wichtig beim Lesen und deshalb auch am Bildschirm vermerkt: die
 * Verteilungen nutzen die **heutigen** Stammdaten. Personio liefert keine
 * Historie — nur die Kopfzahl ist echt stichtagsbezogen.
 */

function Balken({
  titel,
  zeilen,
  alsProzent,
}: {
  titel: string;
  zeilen: { kategorie: string; anzahl: number }[];
  alsProzent: boolean;
}) {
  const worte = useTexte();
  const fmt = useFormate();
  // Die Schlüssel kommen aus Personio, die Namen aus dem Wörterbuch.
  const kategorie: Record<string, string> = {
    maennlich: worte.belegschaft.maennlich,
    weiblich: worte.belegschaft.weiblich,
    divers: worte.belegschaft.divers,
    unbekannt: worte.belegschaft.unbekannt,
    vollzeit: worte.belegschaft.vollzeit,
    teilzeit: worte.belegschaft.teilzeit,
    geringfuegig: worte.belegschaft.geringfuegig,
    extern: worte.belegschaft.extern,
  };
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
              <span className="truncate">{kategorie[z.kategorie] ?? z.kategorie}</span>
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
  const worte = useTexte();
  const fmt = useFormate();
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
        <h2 className="text-base font-semibold">{worte.belegschaft.titel}</h2>
        <p className="max-w-prose text-xs text-[var(--fg-muted)]">
          {worte.belegschaft.hinweis}
        </p>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {worte.belegschaft.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kennzahl
          titel={worte.belegschaft.beschaeftigte}
          wert={fmt.zahl(kopf.data?.gesamt)}
          hinweis={worte.belegschaft.beschaeftigteHinweis}
          laedt={kopf.isLoading}
        />
        <Kennzahl
          titel={worte.belegschaft.neuImQuartal}
          wert={fmt.zahl(kopf.data?.neu)}
          laedt={kopf.isLoading}
        />
        <Kennzahl
          titel={worte.belegschaft.bestand}
          wert={fmt.zahl(kopf.data?.bestand)}
          laedt={kopf.isLoading}
        />
        {kompetenz.data?.eingerichtet === false ? (
          // Nicht eingerichtet: der Satz trägt einen Verweis, deshalb keine
          // `Kennzahl` — deren Hinweis ist reiner Text.
          <Card className="p-4">
            <div className="text-sm text-[var(--fg-muted)]">{worte.belegschaft.kompetenzen}</div>
            <div className="mt-1 font-mono text-2xl font-medium tabular-nums">—</div>
            <div className="mt-1 truncate text-xs text-[var(--fg-muted)]">
              {worte.belegschaft.felderFehlen}
              <Link href="/einstellungen" className="underline underline-offset-4">
                {worte.pfad.seiten["/einstellungen"]}
              </Link>
            </div>
          </Card>
        ) : (
          <Kennzahl
            titel={worte.belegschaft.kompetenzen}
            wert={fmt.prozent(kompetenz.data?.quote)}
            hinweis={worte.belegschaft.kompetenzHinweis(
              fmt.zahl(kompetenz.data?.mit_kompetenz),
              fmt.zahl(kompetenz.data?.aktive),
            )}
            laedt={kompetenz.isLoading}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Balken titel={worte.belegschaft.geschlecht} zeilen={je("geschlecht")} alsProzent />
        <Balken
          titel={worte.belegschaft.beschaeftigungsart}
          zeilen={je("beschaeftigung")}
          alsProzent={false}
        />
        <Balken titel={worte.belegschaft.abteilungen} zeilen={je("abteilung")} alsProzent={false} />
      </div>
    </section>
  );
}
