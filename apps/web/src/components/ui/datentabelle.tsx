"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import { useTexte } from "@/components/sprache/anbieter";
import { Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { useSeitengroesse } from "@/lib/plattform-einstellungen";
import {
  seitenfenster,
  sortiere,
  suche,
  suchfeldSichtbar,
  type Richtung,
  type Spalte,
} from "@/lib/tabelle";
import { cn } from "@/lib/cn";

export interface Tabellenspalte<T> extends Spalte<T> {
  titel: string;
  /** Wie die Zelle aussieht. Ohne Angabe der Rohwert als Text. */
  zelle?: (zeile: T) => ReactNode;
  ausrichtung?: "start" | "end";
  className?: string;
}

/**
 * Die Tabelle der Plattform — eine für alle Seiten.
 *
 * Sie bekommt die **ganze** fachlich gefilterte Menge und macht daraus, was
 * TAB-01/02/03 verlangen: Suche ab mehr als 25 Datensätzen, Sortierung über
 * jede fachliche Spalte und Seiten in der zentral eingestellten Größe. Weil
 * sie die ganze Menge hat, sortiert und sucht sie nie nur die sichtbare Seite.
 *
 * Ändert sich die Menge (anderer Zeitraum, anderer Filter), springt sie auf
 * die erste Seite — sonst stünde man auf Seite 4 einer Liste mit zwei Seiten.
 */
export function Datentabelle<T>({
  zeilen,
  spalten,
  zeilenSchluessel,
  vorsortierung,
  laedt,
  leer,
  werkzeuge,
  zeilenKlasse,
  unterZeile,
  beschriftung,
  zeile,
  huelle,
}: {
  zeilen: readonly T[];
  spalten: readonly Tabellenspalte<T>[];
  zeilenSchluessel: (zeile: T) => string | number;
  vorsortierung?: { spalte: string; richtung: Richtung };
  laedt?: boolean;
  /** Text, wenn die fachliche Menge leer ist. */
  leer?: ReactNode;
  /** Bedienelemente links neben dem Suchfeld (Segmentwahl, Auswahlaktion). */
  werkzeuge?: ReactNode;
  zeilenKlasse?: (zeile: T) => string | undefined;
  /** Aufgeklappter Inhalt unter einer Zeile, über die ganze Breite. */
  unterZeile?: (zeile: T) => ReactNode;
  /** Zugänglicher Name der Tabelle. */
  beschriftung?: string;
  /** Eigene `<tr>` um die fertigen Zellen — etwa eine ziehbare Zeile. */
  zeile?: (zeile: T, zellen: ReactNode) => ReactNode;
  /** Umhüllt die Tabelle (z. B. mit einem Drag-and-drop-Kontext) und erfährt,
   *  welche Zeilen sichtbar sind und ob Suche oder Sortierung wirken. */
  huelle?: (
    tabelle: ReactNode,
    ansicht: {
      sichtbar: readonly T[];
      sortierung: { spalte: string; richtung: Richtung } | null;
      suchtext: string;
    },
  ) => ReactNode;
}) {
  const t = useTexte();
  const groesse = useSeitengroesse();
  const [suchtext, setSuchtext] = useState("");
  const [sortierung, setSortierung] = useState(vorsortierung ?? null);
  const [seite, setSeite] = useState(1);
  // Neue Menge → erste Seite. Als Zustandsvergleich beim Rendern, nicht als
  // Effekt: so gibt es keinen Zwischenstand mit der alten Seitennummer.
  const [vorherigeZeilen, setVorherigeZeilen] = useState(zeilen);
  if (vorherigeZeilen !== zeilen) {
    setVorherigeZeilen(zeilen);
    setSeite(1);
  }

  const sortiert = useMemo(() => {
    const gefunden = suche(zeilen, spalten, suchtext);
    const spalte = sortierung && spalten.find((s) => s.schluessel === sortierung.spalte);
    return spalte ? sortiere(gefunden, spalte, sortierung.richtung) : gefunden;
  }, [zeilen, spalten, suchtext, sortierung]);

  const fenster = seitenfenster(sortiert, groesse, seite);
  const zeigeSuche = suchfeldSichtbar(zeilen.length, suchtext);

  function sortiereNach(spalte: Tabellenspalte<T>) {
    setSeite(1);
    setSortierung((alt) =>
      alt?.spalte === spalte.schluessel
        ? { spalte: spalte.schluessel, richtung: alt.richtung === "auf" ? "ab" : "auf" }
        : // Zahlen und Daten will man meist zuerst groß bzw. neu sehen.
          { spalte: spalte.schluessel, richtung: spalte.typ === "text" ? "auf" : "ab" },
    );
  }

  return (
    <div className="space-y-2">
      {(werkzeuge || zeigeSuche) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">{werkzeuge}</div>
          {zeigeSuche && (
            <label className="relative flex w-full items-center sm:w-72">
              <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-[var(--fg-muted)]" aria-hidden />
              <input
                type="search"
                value={suchtext}
                placeholder={t.tabelle.suche}
                aria-label={beschriftung ? `${t.tabelle.sucheAria}: ${beschriftung}` : t.tabelle.sucheAria}
                onChange={(e) => {
                  setSuchtext(e.target.value);
                  setSeite(1);
                }}
                className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] ps-8 pe-8 text-sm placeholder:text-[var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] [&::-webkit-search-cancel-button]:hidden"
              />
              {suchtext && (
                <button
                  type="button"
                  aria-label={t.tabelle.sucheLeeren}
                  title={t.tabelle.sucheLeeren}
                  onClick={() => {
                    setSuchtext("");
                    setSeite(1);
                  }}
                  className="absolute end-1.5 inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </label>
          )}
        </div>
      )}

      {(huelle ?? ((tabelle: ReactNode) => tabelle))(
      <TableWrap>
        <Table aria-label={beschriftung}>
          <thead>
            <tr>
              {spalten.map((s) => {
                const aktiv = sortierung?.spalte === s.schluessel ? sortierung.richtung : null;
                const sortierbar = s.sortierbar !== false;
                return (
                  <Th
                    key={s.schluessel}
                    className={cn(s.ausrichtung === "end" && "text-end", s.className)}
                    aria-sort={aktiv === "auf" ? "ascending" : aktiv === "ab" ? "descending" : sortierbar ? "none" : undefined}
                  >
                    {sortierbar ? (
                      <button
                        type="button"
                        onClick={() => sortiereNach(s)}
                        title={t.tabelle.sortieren(s.titel)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded font-medium hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
                          s.ausrichtung === "end" && "flex-row-reverse",
                        )}
                      >
                        {s.titel}
                        {aktiv === "auf" ? (
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                        ) : aktiv === "ab" ? (
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      s.titel
                    )}
                  </Th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {laedt ? (
              <tr>
                <Td colSpan={spalten.length} className="text-[var(--fg-muted)]">
                  …
                </Td>
              </tr>
            ) : fenster.gesamt === 0 ? (
              <tr>
                <Td colSpan={spalten.length} className="text-[var(--fg-muted)]">
                  {zeilen.length === 0 ? (leer ?? t.tabelle.leer) : t.tabelle.keineTreffer}
                </Td>
              </tr>
            ) : (
              fenster.zeilen.map((z) => {
                const unter = unterZeile?.(z);
                const zellen = spalten.map((s) => (
                  <Td key={s.schluessel} className={cn(s.ausrichtung === "end" && "text-end tabular-nums", s.className)}>
                    {s.zelle ? s.zelle(z) : alsText(s.wert(z))}
                  </Td>
                ));
                return (
                  <FragmentZeile key={zeilenSchluessel(z)}>
                    {zeile ? zeile(z, zellen) : <tr className={zeilenKlasse?.(z)}>{zellen}</tr>}
                    {unter && (
                      <tr>
                        <Td colSpan={spalten.length} className="bg-[var(--muted)]/40">
                          {unter}
                        </Td>
                      </tr>
                    )}
                  </FragmentZeile>
                );
              })
            )}
          </tbody>
        </Table>
      </TableWrap>,
        { sichtbar: fenster.zeilen, sortierung, suchtext },
      )}

      {!laedt && fenster.gesamt > 0 && (
        <nav
          aria-label={beschriftung}
          className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--fg-muted)]"
        >
          <span aria-live="polite">{t.tabelle.bereich(fenster.von, fenster.bis, fenster.gesamt)}</span>
          {fenster.seiten > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSeite(fenster.seite - 1)}
                disabled={fenster.seite <= 1}
                aria-label={t.tabelle.zurueck}
                title={t.tabelle.zurueck}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] hover:bg-[var(--muted)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
              </button>
              <span className="px-2 tabular-nums">{t.tabelle.seite(fenster.seite, fenster.seiten)}</span>
              <button
                type="button"
                onClick={() => setSeite(fenster.seite + 1)}
                disabled={fenster.seite >= fenster.seiten}
                aria-label={t.tabelle.weiter}
                title={t.tabelle.weiter}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] hover:bg-[var(--muted)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
              </button>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}

function FragmentZeile({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function alsText(wert: unknown): ReactNode {
  if (wert === null || wert === undefined || wert === "") return "—";
  if (wert instanceof Date) return wert.toLocaleDateString();
  return String(wert);
}
