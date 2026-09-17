"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import { useTexte } from "@/components/sprache/anbieter";
import { useSeitengroesse } from "@/lib/plattform-einstellungen";
import { seitenfenster, suchfeldSichtbar, type Fenster } from "@/lib/tabelle";

/**
 * Seiten und Suche für die Matrizen.
 *
 * Eine Matrix ist keine gewöhnliche Tabelle: ihre Spalten sind selbst Daten
 * (Abteilungen, Personen, Schulungen), und die Zeilen stehen in fachlicher
 * Reihenfolge. Geblättert wird deshalb über die Zeilen, Kopf und Spalten
 * bleiben stehen; gesucht wird in der Zeilenbeschriftung — so bleibt jede
 * Zelle unter ihrem Kopf. Seitengröße und Suchschwelle sind dieselben wie bei
 * `Datentabelle` (TAB-01/03); eine Sortierung über Spaltenköpfe gibt es nicht,
 * weil sie die Reihenfolge der Gruppen zerreißen würde.
 */
export function useMatrixseiten<T>(
  zeilen: readonly T[],
  suchwert: (zeile: T) => string,
  { alleAufEinmal = false }: { alleAufEinmal?: boolean } = {},
) {
  // `alleAufEinmal` für Matrizen, deren Zweck die Vollständigkeit ist (die
  // Gesamtmatrix der Schulungen im Audit): dort ist Blättern kein Komfort,
  // sondern verdeckt genau das, was gezeigt werden soll. Gescrollt wird im
  // Rahmen, Kopf und erste Spalte bleiben stehen.
  const seitengroesse = useSeitengroesse();
  const [suchtext, setSuchtext] = useState("");
  const [seite, setSeite] = useState(1);
  const [vorherige, setVorherige] = useState(zeilen);
  if (vorherige !== zeilen) {
    setVorherige(zeilen);
    setSeite(1);
  }

  const gefunden = useMemo(() => {
    const gesucht = suchtext.trim().toLocaleLowerCase("de");
    return gesucht
      ? zeilen.filter((z) => suchwert(z).toLocaleLowerCase("de").includes(gesucht))
      : zeilen;
  }, [zeilen, suchtext, suchwert]);

  const groesse = alleAufEinmal ? Math.max(gefunden.length, 1) : seitengroesse;

  return {
    fenster: seitenfenster(gefunden, groesse, seite),
    suchtext,
    zeigeSuche: suchfeldSichtbar(zeilen.length, suchtext),
    setSuchtext: (text: string) => {
      setSuchtext(text);
      setSeite(1);
    },
    setSeite,
  };
}

export function Matrixsuche({
  wert,
  onChange,
  beschriftung,
}: {
  wert: string;
  onChange: (text: string) => void;
  beschriftung: string;
}) {
  const t = useTexte();
  return (
    <label className="relative flex w-full items-center sm:w-72">
      <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-[var(--fg-muted)]" aria-hidden />
      <input
        type="search"
        value={wert}
        placeholder={t.tabelle.suche}
        aria-label={`${t.tabelle.sucheAria}: ${beschriftung}`}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] ps-8 pe-8 text-sm placeholder:text-[var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] [&::-webkit-search-cancel-button]:hidden"
      />
      {wert && (
        <button
          type="button"
          aria-label={t.tabelle.sucheLeeren}
          title={t.tabelle.sucheLeeren}
          onClick={() => onChange("")}
          className="absolute end-1.5 inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </label>
  );
}

export function Blaettern<T>({
  fenster,
  onSeite,
  beschriftung,
}: {
  fenster: Fenster<T>;
  onSeite: (seite: number) => void;
  beschriftung: string;
}) {
  const t = useTexte();
  if (fenster.gesamt === 0) return null;
  const knopf =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] hover:bg-[var(--muted)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--ring)]";
  return (
    <nav
      aria-label={beschriftung}
      className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--fg-muted)]"
    >
      <span aria-live="polite">{t.tabelle.bereich(fenster.von, fenster.bis, fenster.gesamt)}</span>
      {fenster.seiten > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSeite(fenster.seite - 1)}
            disabled={fenster.seite <= 1}
            aria-label={t.tabelle.zurueck}
            title={t.tabelle.zurueck}
            className={knopf}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
          <span className="px-2 tabular-nums">{t.tabelle.seite(fenster.seite, fenster.seiten)}</span>
          <button
            type="button"
            onClick={() => onSeite(fenster.seite + 1)}
            disabled={fenster.seite >= fenster.seiten}
            aria-label={t.tabelle.weiter}
            title={t.tabelle.weiter}
            className={knopf}
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
        </div>
      )}
    </nav>
  );
}
