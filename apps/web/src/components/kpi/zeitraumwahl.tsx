"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { useTexte } from "@/components/sprache/anbieter";
import { fenster, type Zeitraum } from "@/lib/kpi/gemeinsam";

/** Die üblichen Stufen. Das Personal-Dashboard lässt „Alles" weg — ohne
 *  Fenster wäre der Nenner seiner Quoten unbestimmt. */
export const STUFEN: Zeitraum[] = ["monat", "quartal", "jahr", "alles", "frei"];
export const STUFEN_MIT_FENSTER: Zeitraum[] = ["monat", "quartal", "jahr", "frei"];

function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Zeitraumwahl {
  zeitraum: Zeitraum;
  setZeitraum: (z: Zeitraum) => void;
  frei: { von: string; bis: string };
  setFrei: (f: { von: string; bis: string }) => void;
  von: string | null;
  bis: string | null;
  /** Wahr, wenn bei freier Wahl das Ende vor dem Anfang liegt. */
  verdreht: boolean;
}

/**
 * Zeitraumwahl mit Zustand.
 *
 * Das freie Fenster hat einen eigenen Zustand, der beim Umschalten auf einen
 * Vorschlag **nicht** verlorengeht: wer versehentlich auf „Dieses Jahr" geht,
 * findet seine Daten danach noch vor.
 */
export function useZeitraumwahl(vorgabe: Zeitraum = "jahr"): Zeitraumwahl {
  const [zeitraum, setZeitraum] = useState<Zeitraum>(vorgabe);
  const [frei, setFrei] = useState(() => {
    const bis = heuteIso();
    return { von: `${bis.slice(0, 4)}-01-01`, bis };
  });

  const verdreht = zeitraum === "frei" && frei.von > frei.bis;

  const { von, bis } = useMemo(() => {
    if (zeitraum !== "frei") return fenster(zeitraum);
    // Ein verdrehtes Fenster wird nicht abgefragt — sonst käme eine leere
    // Antwort zurück und sähe aus wie „keine Daten".
    if (frei.von > frei.bis) return { von: null, bis: null };
    return { von: frei.von, bis: frei.bis };
  }, [zeitraum, frei]);

  return { zeitraum, setZeitraum, frei, setFrei, von, bis, verdreht };
}

const FELD =
  "h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm " +
  "focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

/**
 * Die Zeitraumwahl als Auswahlliste — auf allen Seiten dieselbe (KPI-07).
 *
 * Ein `<select>` und kein nachgebautes Menü: mit Tastatur, auf dem Telefon und
 * mit Screenreader ist das Eingebaute besser bedienbar. „Zeitraum wählen" ist
 * ein Eintrag der Liste und öffnet die beiden Datumsfelder darunter.
 *
 * Direkt darunter steht der Datenstand der Seite (KPI-08) — die Frage „wie
 * aktuell ist das?" gehört zu der Frage „welcher Zeitraum?".
 */
export function Zeitraumwahl({
  wahl,
  stufen = STUFEN,
  datenstand,
}: {
  wahl: Zeitraumwahl;
  stufen?: Zeitraum[];
  /** Der Datenstand dieser Seite, unter der Auswahl. */
  datenstand?: ReactNode;
}) {
  const t = useTexte();
  const id = useId();
  return (
    <div className="flex flex-col items-end gap-1">
      <label htmlFor={id} className="sr-only">
        {t.zeitraum.aria}
      </label>
      <div className="relative">
        <select
          id={id}
          value={wahl.zeitraum}
          onChange={(e) => wahl.setZeitraum(e.target.value as Zeitraum)}
          className={`${FELD} w-48 cursor-pointer appearance-none pe-8 font-medium`}
        >
          {stufen.map((z) => (
            <option key={z} value={z}>
              {t.zeitraum[z]}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-muted)]"
          aria-hidden
        />
      </div>

      {wahl.zeitraum === "frei" && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-[var(--fg-muted)]">{t.zeitraum.von}</span>
            <input
              type="date"
              value={wahl.frei.von}
              max={wahl.frei.bis}
              aria-label={t.zeitraum.vonAria}
              onChange={(e) => wahl.setFrei({ ...wahl.frei, von: e.target.value })}
              className={FELD}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[var(--fg-muted)]">{t.zeitraum.bis}</span>
            <input
              type="date"
              value={wahl.frei.bis}
              min={wahl.frei.von}
              aria-label={t.zeitraum.bisAria}
              onChange={(e) => wahl.setFrei({ ...wahl.frei, bis: e.target.value })}
              className={FELD}
            />
          </label>
          {wahl.verdreht && <span className="w-full text-end text-[var(--danger)]">{t.zeitraum.verdreht}</span>}
        </div>
      )}

      {/* Der Datenstand zählt nicht zur Breite: ein langer Stand (etwa der
          Personio-Abgleich mit Uhrzeit) stünde sonst breiter als das Feld,
          und das Feld rückte vom Knopf daneben weg. So bleibt der Abstand auf
          allen Seiten gleich, der Text steht rechtsbündig nach links über. */}
      {datenstand && (
        <div data-datenstand className="flex w-0 min-w-full justify-end whitespace-nowrap text-end">
          {datenstand}
        </div>
      )}
    </div>
  );
}
