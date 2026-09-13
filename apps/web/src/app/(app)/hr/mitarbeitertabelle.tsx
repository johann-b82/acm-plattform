"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  personalApi,
  personalKeys,
  waehleMitarbeiter,
  type MitarbeiterZeile,
  type Mitarbeiterauswahl,
} from "@/lib/kpi/personal";
import { Card, Select } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { cn } from "@/lib/cn";

/**
 * Alle Personen mit Ist-Stunden und Überstunden im gewählten Zeitraum.
 *
 * Rechnet mit denselben Tagessummen und demselben Arbeitszeitmodell wie die
 * Kachel darüber — die Summe der Zeilen ergibt die Kachel. Im Altprojekt
 * weichen die beiden um den Faktor zehn ab, weil die Tabelle dort je
 * Anwesenheitssegment und mit pauschalem Tagessoll rechnet.
 *
 * Die Auswahl darüber (HR-07) bestimmt die fachliche Menge, bevor die Tabelle
 * sucht, sortiert und blättert. Vorgabe ist „Mit Überstunden“ wie im
 * Altsystem. Die Spalten folgen dessen Reihenfolge (HR-08); die Wochenstunden
 * kommen aus dem Arbeitszeitmodell, nicht aus Personios `weekly_working_hours`.
 */
export function Mitarbeitertabelle({ von, bis }: { von: string; bis: string }) {
  const worte = useTexte();
  const t = worte.mitarbeiter;
  const fmt = useFormate();
  const auswahlId = useId();
  const [auswahl, setAuswahl] = useState<Mitarbeiterauswahl>("ueberstunden");

  const zeilen = useQuery({
    queryKey: personalKeys.mitarbeiter(von, bis),
    queryFn: () => personalApi.mitarbeiter(von, bis),
  });

  const menge = useMemo(() => waehleMitarbeiter(zeilen.data ?? [], auswahl), [zeilen.data, auswahl]);

  const spalten = useMemo<Tabellenspalte<MitarbeiterZeile>[]>(() => {
    const statusWert = t.statusWert as Record<string, string>;
    const statusText = (z: MitarbeiterZeile) => (z.status ? (statusWert[z.status] ?? z.status) : null);
    const stunden = (v: number) => (v > 0 ? v.toFixed(2) : "—");
    return [
      { schluessel: "name", titel: t.name, typ: "text", wert: (z) => z.name ?? `#${z.employee_id}` },
      {
        schluessel: "abteilung",
        titel: t.abteilung,
        typ: "text",
        wert: (z) => z.department,
        className: "text-[var(--fg-muted)]",
      },
      {
        schluessel: "position",
        titel: t.position,
        typ: "text",
        wert: (z) => z.position,
        className: "text-[var(--fg-muted)]",
      },
      {
        schluessel: "status",
        titel: t.status,
        typ: "text",
        wert: statusText,
        zelle: (z) =>
          z.status ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                z.status === "active" ? "status-ok" : "status-none",
              )}
            >
              {statusText(z)}
            </span>
          ) : (
            "—"
          ),
      },
      {
        schluessel: "wochenstunden",
        titel: t.wochenstunden,
        typ: "zahl",
        ausrichtung: "end",
        wert: (z) => z.wochenstunden,
        zelle: (z) => fmt.zahl(z.wochenstunden),
        className: "font-mono",
      },
      {
        schluessel: "ist",
        titel: t.istStunden,
        typ: "zahl",
        ausrichtung: "end",
        wert: (z) => z.ist_stunden,
        zelle: (z) => stunden(z.ist_stunden),
        className: "font-mono",
      },
      {
        schluessel: "ueberstunden",
        titel: t.ueberstunden,
        typ: "zahl",
        ausrichtung: "end",
        wert: (z) => z.ueberstunden,
        zelle: (z) => stunden(z.ueberstunden),
        className: "font-mono font-medium",
      },
      {
        schluessel: "quote",
        titel: t.quote,
        typ: "zahl",
        ausrichtung: "end",
        wert: (z) => z.quote,
        zelle: (z) => fmt.prozent(z.quote),
        className: "font-mono text-[var(--fg-muted)]",
      },
    ];
  }, [t, fmt]);

  if (zeilen.error) {
    return (
      <Card className="p-4 text-sm text-[var(--danger)]">
        {worte.dashboard.ladeFehler((zeilen.error as Error).message)}
      </Card>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{t.titel}</h2>
      <Datentabelle
        zeilen={menge}
        spalten={spalten}
        zeilenSchluessel={(z) => z.employee_id}
        vorsortierung={{ spalte: "ueberstunden", richtung: "ab" }}
        laedt={zeilen.isLoading}
        leer={t.leer}
        beschriftung={t.titel}
        werkzeuge={
          <div className="flex items-center gap-2">
            <label htmlFor={auswahlId} className="text-sm text-[var(--fg-muted)]">
              {t.auswahl}
            </label>
            <Select
              id={auswahlId}
              value={auswahl}
              onChange={(e) => setAuswahl(e.target.value as Mitarbeiterauswahl)}
              className="w-48"
            >
              <option value="ueberstunden">{t.mitUeberstunden}</option>
              <option value="aktive">{t.aktive}</option>
              <option value="alle">{t.alle}</option>
            </Select>
          </div>
        }
      />
    </section>
  );
}
