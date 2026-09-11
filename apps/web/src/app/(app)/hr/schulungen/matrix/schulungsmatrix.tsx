"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import {
  DRINGLICHKEIT_LABEL,
  HERKUNFT_LABEL,
  dringlichkeit,
  schulungApi,
  schulungKeys,
  type Dringlichkeit,
  type Person,
  type Schulung,
  type Stand,
} from "@/lib/schulungen";
import { Card, EmptyState, Input, Select, TableWrap } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" });

/** Die Farbe der Zelle sagt dasselbe wie die Liste „was offen ist". */
const ZELLE: Record<Dringlichkeit, string> = {
  nie: "status-bad",
  ueberfaellig: "status-bad",
  faellig_bald: "status-warn",
  offen: "status-ok",
};

/**
 * Die Kreuztabelle: alle Personen gegen alle Schulungen.
 *
 * Sie beantwortet eine andere Frage als die Liste „was offen ist". Die Liste
 * sagt, wer als Nächstes dran ist — die Matrix, ob für jede Person und jede
 * Schulung überhaupt ein Datum steht. Das ist die Frage aus dem Audit, und
 * dafür muss auch die **leere Zeile** sichtbar sein: jemand ohne jede
 * Teilnahme ist genau der Fall, den man sucht.
 *
 * Gepivotet wird hier und nicht in SQL. Eine Kreuztabelle in Postgres bräuchte
 * dynamische Spalten, also eine Spaltenliste, die sich bei jeder neuen
 * Schulung ändert. Die Mengen sind klein (Belegschaft × Katalog), das Pivot
 * kostet nichts.
 */
export function Schulungsmatrix() {
  const [suche, setSuche] = useState("");
  const [bereich, setBereich] = useState("alle");
  const [nurLuecken, setNurLuecken] = useState(false);

  const personen = useQuery({
    queryKey: schulungKeys.belegschaft(),
    queryFn: schulungApi.belegschaft,
  });
  const stand = useQuery({ queryKey: schulungKeys.stand(), queryFn: schulungApi.stand });
  const katalog = useQuery({ queryKey: schulungKeys.katalog(), queryFn: schulungApi.katalog });

  const bereiche = useMemo(
    () => [...new Set((katalog.data ?? []).map((s) => s.bereich))].sort(),
    [katalog.data],
  );

  /** Spalten: die aktiven Schulungen des gewählten Bereichs. */
  const spalten = useMemo(
    () =>
      (katalog.data ?? [])
        .filter((s) => s.aktiv && (bereich === "alle" || s.bereich === bereich))
        .sort((a, b) => a.bereich.localeCompare(b.bereich) || a.name.localeCompare(b.name)),
    [katalog.data, bereich],
  );

  /** Zellen: Schlüssel „<person>|<schulung>", damit das Nachschlagen O(1) bleibt. */
  const zellen = useMemo(() => {
    const karte = new Map<string, Stand>();
    for (const s of stand.data ?? []) karte.set(`${s.schluessel}|${s.schulung_id}`, s);
    return karte;
  }, [stand.data]);

  const zeilen = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return (personen.data ?? []).filter((p) => {
      if (begriff) {
        const heuhaufen = `${p.name ?? ""} ${p.abteilung ?? ""} ${p.personalnummer ?? ""}`;
        if (!heuhaufen.toLowerCase().includes(begriff)) return false;
      }
      if (!nurLuecken) return true;
      return spalten.some((s) => {
        const zelle = zellen.get(`${p.schluessel}|${s.id}`);
        return !zelle || zelle.nie_absolviert || zelle.ueberfaellig;
      });
    });
  }, [personen.data, suche, nurLuecken, spalten, zellen]);

  const laedt = personen.isPending || stand.isPending || katalog.isPending;
  const fehler = personen.error ?? stand.error ?? katalog.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schulungsmatrix</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Alle Personen gegen alle Schulungen — die Übersicht für den Aushang
            und fürs Audit. Wer noch gar keine Teilnahme hat, steht mit leerer
            Zeile darin; genau das ist die Lücke, die man sucht.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/hr/schulungen/offen" className="underline-offset-4 hover:underline">
            Was offen ist
          </Link>
          <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
            Katalog
          </Link>
        </div>
      </div>

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1">
          <label htmlFor="matrix-suche" className="text-sm font-medium">
            Person oder Abteilung
          </label>
          <Input
            id="matrix-suche"
            value={suche}
            placeholder="Name, Abteilung, Personalnummer"
            className="w-64"
            onChange={(e) => setSuche(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="matrix-bereich" className="text-sm font-medium">
            Bereich
          </label>
          <Select
            id="matrix-bereich"
            value={bereich}
            className="w-48"
            onChange={(e) => setBereich(e.target.value)}
          >
            <option value="alle">Alle Bereiche</option>
            {bereiche.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={nurLuecken}
            onChange={(e) => setNurLuecken(e.target.checked)}
            className="h-4 w-4 accent-[var(--ring)]"
          />
          Nur Personen mit Lücken
        </label>
        <span className="pb-2 text-sm text-[var(--fg-muted)]">
          {zeilen.length} von {personen.data?.length ?? 0} Personen · {spalten.length} Schulungen
        </span>
      </Card>

      {fehler && <p className="text-sm text-[var(--danger)]">{(fehler as Error).message}</p>}
      {laedt && <p className="text-sm text-[var(--fg-muted)]">Wird geladen …</p>}

      {!laedt && !fehler && zeilen.length === 0 && (
        <EmptyState
          title="Keine Person passt"
          body="Andere Suche oder anderer Bereich — oder es ist wirklich niemand offen."
        />
      )}

      {!laedt && !fehler && zeilen.length > 0 && (
        <TableWrap className="max-h-[70vh] overflow-auto">
          {/* Keine feste Breite: die Tabelle ist so breit wie ihr Inhalt.
                `w-full` schöbe bei wenigen Schulungen die ganze Leerbreite in
                die Namensspalte. */}
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                {/* Die Kopfspalte bleibt stehen — ohne sie weiß nach drei
                    Spalten niemand mehr, wessen Zeile er liest. */}
                <th
                  className={
                    "sticky left-0 top-0 z-20 w-64 border-b border-[var(--border)] " +
                    "bg-[var(--surface)] px-3 py-2 text-left font-medium"
                  }
                >
                  Person
                </th>
                {spalten.map((s) => (
                  <th
                    key={s.id}
                    className={
                      "sticky top-0 z-10 border-b border-[var(--border)] " +
                      "bg-[var(--surface)] px-1 pt-3 align-bottom font-medium"
                    }
                    title={`${s.bereich} · ${s.name}`}
                  >
                    {/* Senkrecht von unten nach oben, nicht schräg: schräge
                        Beschriftungen ragen aus ihrer Zelle heraus und werden
                        vom Rollbereich abgeschnitten. So bleibt die Spalte so
                        schmal wie ihr Inhalt und die Überschrift vollständig. */}
                    <span
                      className="mx-auto block max-h-56 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                    >
                      {s.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zeilen.map((p) => (
                <tr key={p.schluessel} className="even:bg-[var(--muted)]/40">
                  <th
                    scope="row"
                    className={
                      "sticky left-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] " +
                      "px-3 py-2 text-left font-normal"
                    }
                  >
                    <span className="block truncate font-medium">{p.name ?? "—"}</span>
                    <span className="block truncate text-xs text-[var(--fg-muted)]">
                      {[p.abteilung, p.herkunft !== "personio" ? HERKUNFT_LABEL[p.herkunft] : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </th>
                  {spalten.map((s) => (
                    <Zelle key={s.id} zelle={zellen.get(`${p.schluessel}|${s.id}`)} person={p} schulung={s} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

function Zelle({
  zelle,
  person,
  schulung,
}: {
  zelle: Stand | undefined;
  person: Person;
  schulung: Schulung;
}) {
  // Keine Teilnahme heißt: nie zugewiesen. Das ist etwas anderes als
  // „zugewiesen und nicht absolviert" und darf nicht gleich aussehen.
  if (!zelle) {
    return (
      <td
        className="border-b border-[var(--border)] px-1 py-2 text-center text-[var(--fg-muted)]"
        title={`${person.name ?? "?"} · ${schulung.name}: nicht zugewiesen`}
      >
        ·
      </td>
    );
  }
  const wie = dringlichkeit(zelle);
  return (
    <td className="border-b border-[var(--border)] px-1 py-1 text-center">
      <span
        className={cn(
          "inline-block w-full rounded px-1 py-1 text-[11px] tabular-nums",
          ZELLE[wie],
        )}
        title={
          `${person.name ?? "?"} · ${schulung.name}: ${DRINGLICHKEIT_LABEL[wie]}` +
          (zelle.faellig_am ? ` (fällig ${DATUM.format(new Date(zelle.faellig_am))})` : "")
        }
      >
        {zelle.aktuell_datum ? DATUM.format(new Date(zelle.aktuell_datum)) : "offen"}
      </span>
    </td>
  );
}
