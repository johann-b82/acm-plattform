"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";


import {
  personalApi,
  personalKeys,
  prozente,
} from "@/lib/kpi/personal";
import { Card, Label, Select } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { useFormate } from "@/lib/kpi/use-formate";

/** Quartalsende als ISO-Datum (Stichtag), z. B. (2024, 4) → 2024-12-31. */
function quartalsende(jahr: number, quartal: number): string {
  const monat = quartal * 3; // 1-indiziert; Tag 0 des Folgemonats = letzter Tag
  const d = new Date(Date.UTC(jahr, monat, 0));
  return d.toISOString().slice(0, 10);
}

/** Die wählbaren Jahre: die letzten sechs, das laufende zuoberst. */
function jahre(): number[] {
  const jetzt = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => jetzt - i);
}

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
}: {
  titel: string;
  zeilen: { kategorie: string; anzahl: number }[];
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
                {`${fmt.zahl(z.anzahl)} (${z.prozent} %)`}
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-[var(--muted)]">
              <div
                className="h-1.5 bg-[var(--ring)]"
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
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "long" });
  // Stichtag: null = heutiger Stand; sonst ein vergangenes Quartalsende. Kopfzahl,
  // Neu/Bestand, Verteilungen und Kompetenzquote lesen denselben Stichtag.
  const [jahr, setJahr] = useState<number | null>(null);
  const [quartal, setQuartal] = useState(4);
  const historisch = jahr !== null;
  const stichtag = historisch ? quartalsende(jahr, quartal) : null;

  const kopf = useQuery({
    queryKey: [...personalKeys.belegschaft(), jahr, quartal],
    queryFn: () => personalApi.belegschaft(jahr ?? undefined, historisch ? quartal : undefined),
  });
  const verteilung = useQuery({
    queryKey: [...personalKeys.belegschaft(), "verteilung", jahr, quartal],
    queryFn: () => personalApi.verteilung(jahr ?? undefined, historisch ? quartal : undefined),
  });
  const kompetenz = useQuery({
    queryKey: personalKeys.kompetenz(stichtag ?? "heute"),
    queryFn: () => personalApi.kompetenz(stichtag ?? undefined),
  });

  const zeilen = verteilung.data ?? [];
  const je = (art: string) =>
    zeilen.filter((z) => z.art === art).map((z) => ({ kategorie: z.kategorie, anzahl: z.anzahl }));

  const fehler = kopf.error ?? verteilung.error ?? kompetenz.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-base font-semibold">{worte.belegschaft.titel}</h2>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="belegschaft-jahr">{worte.belegschaft.zeitpunkt}</Label>
            <Select
              id="belegschaft-jahr"
              aria-label={worte.belegschaft.zeitpunkt}
              value={jahr ?? ""}
              onChange={(e) => setJahr(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">{worte.belegschaft.aktuell}</option>
              {jahre().map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </Select>
          </div>
          {historisch && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="belegschaft-quartal">{worte.belegschaft.quartal}</Label>
              <Select
                id="belegschaft-quartal"
                aria-label={worte.belegschaft.quartal}
                value={quartal}
                onChange={(e) => setQuartal(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((q) => (
                  <option key={q} value={q}>{`Q${q}`}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-[var(--fg-muted)]">
        {historisch && kopf.data?.stichtag
          ? `${worte.belegschaft.zeitpunkt}: ${DATUM.format(new Date(kopf.data.stichtag))} — ${worte.belegschaft.stichtagHinweis}`
          : worte.belegschaft.stichtagHinweis}
      </p>

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
        <Balken titel={worte.belegschaft.geschlecht} zeilen={je("geschlecht")} />
        <Balken titel={worte.belegschaft.beschaeftigungsart} zeilen={je("beschaeftigung")} />
        <Balken titel={worte.belegschaft.abteilungen} zeilen={je("abteilung")} />
      </div>
    </section>
  );
}
