"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  abteilungenMitVorgesetzten,
  dringlichkeit,
  faelligeSchulungen,
  imStandort,
  mitarbeiterstand,
  schulungApi,
  schulungKeys,
  standBelegschaft,
  standorte,
  tagesdatum,
  type FaelligeZeile,
  type Mitarbeiterstand,
  type Person,
  type Schulung,
  type Stand,
} from "@/lib/schulungen";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { useDringlichkeit } from "@/lib/tafeln";
import { Seitenwerkzeuge, Werkzeug } from "@/components/sidebar/werkzeugplatz";
import { Klappbar } from "../klappbar";
import { Standortfilter, umschalten } from "../standortfilter";
import { Matrixsuche, useMatrixseiten } from "../matrixseiten";

/**
 * Register „Stand der Mitarbeiter“.
 *
 * Ein Standortfilter in der rechten Leiste wirkt auf alle vier Sichten
 * (SCH-02): die offenen Schulungen, die Mitarbeiterübersicht samt Zählern, die Gesamtmatrix und die
 * Abteilungen. Leere Auswahl heißt alle Standorte. Die Fälligkeit rechnet
 * `lib/schulungen` wie das Altsystem (überfällig plus drei Monate) — so ergeben
 * sich die 65 offenen Einträge, nicht die 274 der früheren, gröberen Zählung.
 */
export function RegisterStand() {
  const worte = useTexte();
  const heute = tagesdatum(new Date());

  const belegschaft = useQuery({ queryKey: schulungKeys.belegschaft(), queryFn: schulungApi.belegschaft });
  const stand = useQuery({ queryKey: schulungKeys.stand(), queryFn: schulungApi.stand });
  const katalog = useQuery({ queryKey: schulungKeys.katalog(), queryFn: schulungApi.katalog });

  const [gewaehlteOrte, setGewaehlteOrte] = useState<Set<string>>(new Set());

  const belegschaftDaten = belegschaft.data;
  const alle = useMemo(() => standBelegschaft(belegschaftDaten ?? []), [belegschaftDaten]);
  const orte = useMemo(() => standorte(alle), [alle]);
  const personen = useMemo(() => alle.filter((p) => imStandort(p, gewaehlteOrte)), [alle, gewaehlteOrte]);

  const standDaten = stand.data ?? [];
  const katalogDaten = katalog.data ?? [];
  const laedt = belegschaft.isPending || stand.isPending || katalog.isPending;

  return (
    <div className="space-y-6">
      <Seitenwerkzeuge kategorie="filter">
        <Werkzeug titel={worte.schulungenReg.standort}>
          <Standortfilter
            standorte={orte}
            gewaehlt={gewaehlteOrte}
            beschriftung={worte.schulungenReg.standort}
            onToggle={(o) => setGewaehlteOrte((v) => umschalten(v, o))}
          />
        </Werkzeug>
      </Seitenwerkzeuge>

      <Offene stand={standDaten} personen={personen} katalog={katalogDaten} heute={heute} laedt={laedt} />
      <MitarbeiterUebersicht stand={standDaten} personen={personen} katalog={katalogDaten} heute={heute} />
      <Gesamtmatrix stand={standDaten} personen={personen} katalog={katalogDaten} heute={heute} />
      <Abteilungen />
    </div>
  );
}

function Offene({
  stand,
  personen,
  katalog,
  heute,
  laedt,
}: {
  stand: Stand[];
  personen: Person[];
  katalog: Schulung[];
  heute: string;
  laedt: boolean;
}) {
  const worte = useTexte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const [filter, setFilter] = useState<"alle" | "ueberfaellig" | "bald">("alle");

  const alle = useMemo(() => faelligeSchulungen(stand, personen, katalog, heute), [stand, personen, katalog, heute]);
  const ueberfaellig = alle.filter((z) => z.status === "ueberfaellig").length;
  const bald = alle.length - ueberfaellig;
  const gezeigt = useMemo(() => (filter === "alle" ? alle : alle.filter((z) => z.status === filter)), [alle, filter]);

  const spalten: Tabellenspalte<FaelligeZeile>[] = [
    { schluessel: "person", titel: worte.offeneSchulungen.person, typ: "text", wert: (z) => z.person.name, zelle: (z) => z.person.name ?? "—" },
    { schluessel: "abteilung", titel: worte.schulungenReg.abteilung, typ: "text", wert: (z) => z.person.abteilung },
    { schluessel: "standort", titel: worte.schulungenReg.standort, typ: "text", wert: (z) => z.person.standort },
    { schluessel: "schulung", titel: worte.offeneSchulungen.schulung, typ: "text", wert: (z) => z.stand.schulung },
    { schluessel: "bereich", titel: worte.offeneSchulungen.bereich, typ: "text", wert: (z) => z.stand.bereich },
    {
      schluessel: "faellig",
      titel: worte.offeneSchulungen.faellig,
      typ: "datum",
      suchtext: false,
      wert: (z) => z.faellig,
      zelle: (z) => DATUM.format(new Date(z.faellig)),
    },
    {
      schluessel: "frist",
      titel: worte.schulungenReg.frist,
      typ: "zahl",
      suchtext: false,
      ausrichtung: "end",
      wert: (z) => z.tage,
      zelle: (z) => (
        <Badge className={z.tage < 0 ? "status-bad" : "status-warn"}>
          {z.tage < 0 ? worte.schulungenReg.seit(Math.abs(z.tage)) : worte.schulungenReg.in(z.tage)}
        </Badge>
      ),
    },
  ];

  return (
    <Klappbar titel={worte.schulungenReg.offeneTitel} anzahl={alle.length} offenStart>
      <div className="p-4">
        <Datentabelle
          zeilen={gezeigt}
          spalten={spalten}
          zeilenSchluessel={(z) => `${z.person.schluessel}|${z.stand.teilnahme_id}`}
          laedt={laedt}
          leer={worte.offeneSchulungen.nichtsOffenText}
          beschriftung={worte.schulungenReg.offeneTitel}
          vorsortierung={{ spalte: "faellig", richtung: "auf" }}
          werkzeuge={
            <div className="flex gap-1" role="group" aria-label={worte.offeneSchulungen.allesOffene}>
              {(
                [
                  ["alle", worte.offeneSchulungen.allesOffene, alle.length],
                  ["ueberfaellig", worte.offeneSchulungen.ueberfaellig, ueberfaellig],
                  ["bald", worte.offeneSchulungen.wirdFaellig, bald],
                ] as const
              ).map(([wert, titel, anzahl]) => (
                <button
                  key={wert}
                  type="button"
                  aria-pressed={filter === wert}
                  onClick={() => setFilter(wert)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1 text-xs",
                    filter === wert ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
                  )}
                >
                  {titel}
                  <span className="tabular-nums opacity-70">{anzahl}</span>
                </button>
              ))}
            </div>
          }
        />
      </div>
    </Klappbar>
  );
}

function MitarbeiterUebersicht({
  stand,
  personen,
  katalog,
  heute,
}: {
  stand: Stand[];
  personen: Person[];
  katalog: Schulung[];
  heute: string;
}) {
  const worte = useTexte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const zeilen = useMemo(() => mitarbeiterstand(stand, personen, katalog, heute), [stand, personen, katalog, heute]);

  const spalten: Tabellenspalte<Mitarbeiterstand>[] = [
    { schluessel: "name", titel: worte.offeneSchulungen.person, typ: "text", wert: (m) => m.person.name, zelle: (m) => m.person.name ?? "—" },
    { schluessel: "abteilung", titel: worte.schulungenReg.abteilung, typ: "text", wert: (m) => m.person.abteilung },
    { schluessel: "standort", titel: worte.schulungenReg.standort, typ: "text", wert: (m) => m.person.standort },
    { schluessel: "schulungen", titel: worte.schulungenReg.anzahl, typ: "zahl", suchtext: false, ausrichtung: "end", wert: (m) => m.schulungen },
    {
      schluessel: "ueberfaellig",
      titel: worte.offeneSchulungen.ueberfaellig,
      typ: "zahl",
      suchtext: false,
      ausrichtung: "end",
      wert: (m) => m.ueberfaellig,
      zelle: (m) => (m.ueberfaellig > 0 ? <span className="text-[var(--danger)]">{m.ueberfaellig}</span> : "0"),
    },
    { schluessel: "bald", titel: worte.offeneSchulungen.wirdFaellig, typ: "zahl", suchtext: false, ausrichtung: "end", wert: (m) => m.bald },
    {
      schluessel: "naechste",
      titel: worte.schulungenReg.naechste,
      typ: "datum",
      suchtext: false,
      wert: (m) => m.naechste,
      zelle: (m) => (m.naechste ? DATUM.format(new Date(m.naechste)) : "—"),
    },
  ];

  return (
    <Klappbar titel={worte.schulungenReg.mitarbeiterTitel} anzahl={zeilen.length} offenStart={false}>
      <div className="p-4">
        <Datentabelle
          zeilen={zeilen}
          spalten={spalten}
          zeilenSchluessel={(m) => m.person.schluessel}
          beschriftung={worte.schulungenReg.mitarbeiterTitel}
        />
      </div>
    </Klappbar>
  );
}

/** Die Kreuztabelle: alle Personen gegen alle aktiven Schulungen. */
function Gesamtmatrix({
  stand,
  personen,
  katalog,
  heute,
}: {
  stand: Stand[];
  personen: Person[];
  katalog: Schulung[];
  heute: string;
}) {
  const worte = useTexte();
  const dringlichkeitLabel = useDringlichkeit();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "short" });

  const spalten = useMemo(
    () => katalog.filter((s) => s.aktiv).sort((a, b) => a.bereich.localeCompare(b.bereich) || a.name.localeCompare(b.name)),
    [katalog],
  );
  const zellen = useMemo(() => {
    const karte = new Map<string, Stand>();
    for (const s of stand) karte.set(`${s.schluessel}|${s.schulung_id}`, s);
    return karte;
  }, [stand]);

  const suchwert = useCallback((p: Person) => `${p.name ?? ""} ${p.abteilung ?? ""}`, []);
  // Alle Personen auf einmal: die Gesamtmatrix ist der Nachweis „jede Person
  // gegen jede Pflichtschulung" (Migration 0034). Mit 25 Zeilen je Seite
  // zeigte sie von 82 Personen ein knappes Drittel.
  const seiten = useMatrixseiten(personen, suchwert, { alleAufEinmal: true });
  const heuteDate = useMemo(() => new Date(heute), [heute]);

  return (
    <Klappbar titel={worte.schulungenReg.matrixTitel} anzahl={personen.length} offenStart={false}>
      <div className="space-y-3 p-4">
        {seiten.zeigeSuche && (
          <Matrixsuche wert={seiten.suchtext} onChange={seiten.setSuchtext} beschriftung={worte.schulungenReg.matrixTitel} />
        )}
        {personen.length === 0 || spalten.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">{worte.schulungenReg.matrixLeer}</p>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto rounded-md border border-[var(--border)]">
              <table className="border-collapse text-sm" aria-label={worte.schulungenReg.matrixTitel}>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky start-0 top-0 z-20 min-w-64 border-b border-e border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium"
                    >
                      {worte.offeneSchulungen.person}
                    </th>
                    {spalten.map((s) => (
                      <th
                        key={s.id}
                        scope="col"
                        title={`${s.bereich} · ${s.name}`}
                        className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--muted)] px-1 pt-3 align-bottom font-medium"
                      >
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
                  {seiten.fenster.zeilen.map((p) => (
                    <tr key={p.schluessel}>
                      <th
                        scope="row"
                        className="sticky start-0 z-10 border-b border-e border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-start font-normal"
                      >
                        <span className="block truncate font-medium">{p.name ?? "—"}</span>
                        <span className="block truncate text-xs text-[var(--fg-muted)]">{p.abteilung}</span>
                      </th>
                      {spalten.map((s) => {
                        const zelle = zellen.get(`${p.schluessel}|${s.id}`);
                        if (!zelle) {
                          return (
                            <td
                              key={s.id}
                              title={worte.schulungsmatrix.nichtZugewiesen(p.name ?? "?", s.name)}
                              className="border-b border-[var(--border)] px-1 py-2 text-center text-[var(--fg-muted)]"
                            >
                              ·
                            </td>
                          );
                        }
                        const wie = dringlichkeit(zelle, heuteDate);
                        return (
                          <td key={s.id} className="border-b border-[var(--border)] px-1 py-1 text-center">
                            <span
                              className={cn("inline-block w-full rounded px-1 py-1 text-[11px] tabular-nums", ZELLE[wie])}
                              title={worte.schulungsmatrix.zelle(p.name ?? "?", s.name, dringlichkeitLabel[wie])}
                            >
                              {zelle.aktuell_datum ? DATUM.format(new Date(zelle.aktuell_datum)) : worte.schulungsmatrix.offen}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Klappbar>
  );
}

const ZELLE: Record<ReturnType<typeof dringlichkeit>, string> = {
  nie: "status-bad",
  ueberfaellig: "status-bad",
  faellig_bald: "status-warn",
  offen: "status-ok",
};

/** Abteilungen & Vorgesetzte (SCH-06) — aus dem Organigramm abgeleitet. */
function Abteilungen() {
  const worte = useTexte();
  const organigramm = useQuery({ queryKey: ["schulungen", "organigramm"], queryFn: schulungApi.organigramm });
  const zeilen = useMemo(() => abteilungenMitVorgesetzten(organigramm.data ?? []), [organigramm.data]);

  type Zeile = (typeof zeilen)[number];
  const spalten: Tabellenspalte<Zeile>[] = [
    { schluessel: "abteilung", titel: worte.schulungenReg.abteilung, typ: "text", wert: (a) => a.abteilung },
    {
      schluessel: "vorgesetzte",
      titel: worte.schulungenReg.vorgesetzter,
      typ: "text",
      wert: (a) => a.vorgesetzte.join(", "),
      zelle: (a) =>
        a.vorgesetzte.length ? (
          <ul className="space-y-0.5">
            {a.vorgesetzte.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        ) : (
          <span className="text-[var(--fg-muted)]">—</span>
        ),
    },
    { schluessel: "mitarbeiter", titel: worte.schulungenReg.anzahl, typ: "zahl", suchtext: false, ausrichtung: "end", wert: (a) => a.mitarbeiter },
  ];

  return (
    <Klappbar titel={worte.schulungenReg.abteilungenTitel} anzahl={zeilen.length} offenStart={false}>
      <div className="space-y-2 p-4">
        <Datentabelle
          zeilen={zeilen}
          spalten={spalten}
          zeilenSchluessel={(a) => a.abteilung}
          laedt={organigramm.isPending}
          beschriftung={worte.schulungenReg.abteilungenTitel}
          vorsortierung={{ spalte: "mitarbeiter", richtung: "ab" }}
        />
        <p className="text-sm text-[var(--fg-muted)]">{worte.schulungenReg.abteilungenHinweis}</p>
      </div>
    </Klappbar>
  );
}
