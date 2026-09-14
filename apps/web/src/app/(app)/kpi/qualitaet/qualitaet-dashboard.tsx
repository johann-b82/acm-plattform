"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { takt } from "@/lib/kpi/gemeinsam";
import {
  AUDIT_ARTEN,
  PRUEFKLASSEN,
  ohneLevel,
  onQuality,
  pruefleistungVergleich,
  pruefungApi,
  qualitaetApi,
  reklamationApi,
  verlaufJeBucket,
  type Artikelart,
  type AuditFinding,
  type BuchungsZeile,
  type Mengenart,
  type Pruefklasse,
  type PruefVerlaufPunkt,
  type ReklamationsArt,
  type ReklamationZeile,
} from "@/lib/kpi/qualitaet";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Card } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { Datenstand } from "@/components/kpi/datenstand";
import { DiagrammartWahl, useDiagrammart, type Diagrammart } from "@/components/kpi/diagrammart";
import { Seitenkopf } from "@/components/seitenkopf";
import { Seitenwerkzeuge, Werkzeug, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { Leistenwahl } from "@/components/sidebar/leistenwahl";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { ZAHL_TAG } from "@/lib/sprache";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { cn } from "@/lib/cn";

type Ansicht = "audits" | "reklamationen" | "pruefung";

/** Eine feste leere Liste: `?? []` wäre bei jedem Rendern eine neue, und die
 *  Tabelle hielte das für eine neue Menge. */
const KEINE: never[] = [];

/**
 * Qualitätskennzahlen in drei Ansichten (QUA-04): Audits, Reklamationen,
 * Qualitätsprüfung. Der Zeitraum gilt für alle; die Filter einer Ansicht
 * bleiben beim Umschalten stehen, wirken aber nur in ihrer Ansicht. Jede
 * Ansicht lädt erst, wenn sie gezeigt wird.
 */
export function QualitaetDashboard() {
  const worte = useTexte();
  const wahl = useZeitraumwahl();
  const [ansicht, setAnsicht] = useState<Ansicht>("audits");
  const [arten, setArten] = useState<string[]>([...AUDIT_ARTEN]);
  const [reklArt, setReklArt] = useState<ReklamationsArt>("kunde");
  const [mengenart, setMengenart] = useState<Mengenart>("gesamt");
  const [artikelart, setArtikelart] = useState<Artikelart>("fertig");

  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const zielNach = nachSchluessel(ziele.data ?? []);

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.qualitaet.einleitung}
        links={
          <>
            {/* Kein eigener Titel: er stünde gleich unter der Kategorie „Ansicht“. */}
            <Segmentwahl
              beschriftung={worte.qualitaet.ansicht}
              wert={ansicht}
              onChange={setAnsicht}
              optionen={[
                ["audits", worte.qualitaet.ansichtAudits],
                ["reklamationen", worte.qualitaet.ansichtReklamationen],
                ["pruefung", worte.qualitaet.ansichtPruefung],
              ]}
            />
            {/* Der Filter einer Ansicht steht in derselben Zeile wie der
                Umschalter — nur, solange die Ansicht zu sehen ist. In der
                Schale steht er unter „Filter“. */}
            {ansicht === "audits" && (
              <Seitenwerkzeuge kategorie="filter">
                <AuditartWahl arten={arten} setArten={setArten} />
              </Seitenwerkzeuge>
            )}
            {ansicht === "pruefung" && (
              <Seitenwerkzeuge kategorie="filter">
                <Werkzeug titel={worte.qualitaet.artikelart}>
                  <Segmentwahl
                    beschriftung={worte.qualitaet.artikelart}
                    wert={artikelart}
                    onChange={setArtikelart}
                    optionen={[
                      ["fertig", worte.qualitaet.artikelFertig],
                      ["halbfertig", worte.qualitaet.artikelHalbfertig],
                      ["alle", worte.qualitaet.artikelAlle],
                    ]}
                  />
                </Werkzeug>
              </Seitenwerkzeuge>
            )}
          </>
        }
        bedienung={
          <>
            <Zeitraumwahl wahl={wahl} datenstand={<Datenstand bereich="qualitaet" />} />
          </>
        }
      />

      <Ladefehler fehler={ziele.error} />

      {ansicht === "audits" && (
        <Audits wahl={wahl} arten={arten} zielNach={zielNach} />
      )}
      {ansicht === "reklamationen" && (
        <Reklamationen
          wahl={wahl}
          reklArt={reklArt}
          setReklArt={setReklArt}
          mengenart={mengenart}
          setMengenart={setMengenart}
          zielNach={zielNach}
        />
      )}
      {ansicht === "pruefung" && (
        <Pruefung wahl={wahl} artikelart={artikelart} zielNach={zielNach} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

/** Die Schlüssel kommen aus der Datenbank, die Namen aus dem Wörterbuch. */
function useAuditLabel(): Record<string, string> {
  const worte = useTexte();
  return {
    "BH AUD": worte.qualitaet.behoerde,
    "EX AUD": worte.qualitaet.extern,
    "IN AUD": worte.qualitaet.intern,
    "KU AUD": worte.qualitaet.kunde,
  };
}

function AuditartWahl({
  arten,
  setArten,
}: {
  arten: string[];
  setArten: Dispatch<SetStateAction<string[]>>;
}) {
  const worte = useTexte();
  const auditLabel = useAuditLabel();
  const inSchale = useInSchale();

  function umschalten(art: string) {
    setArten((vorher) => (vorher.includes(art) ? vorher.filter((a) => a !== art) : [...vorher, art]));
  }

  const knoepfe = AUDIT_ARTEN.map((art) => (
    <button
      key={art}
      type="button"
      onClick={() => umschalten(art)}
      aria-pressed={arten.includes(art)}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        arten.includes(art)
          ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]"
          : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      {auditLabel[art]}
    </button>
  ));

  // In der Schale trägt der Titel der Leiste die Beschriftung, ohne Doppelpunkt.
  if (inSchale) {
    return (
      <Werkzeug titel={worte.qualitaet.auditart.replace(/:$/, "")}>
        <div className="flex flex-wrap gap-2">{knoepfe}</div>
      </Werkzeug>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 ms-2">
      <span className="text-sm text-[var(--fg-muted)]">{worte.qualitaet.auditart}</span>
      {knoepfe}
    </div>
  );
}

function Audits({
  wahl,
  arten,
  zielNach,
}: {
  wahl: Zeitraumwahl;
  arten: string[];
  zielNach: Record<string, number>;
}) {
  const worte = useTexte();
  const fmt = useFormate();
  const tag = ZAHL_TAG[useSprache()];
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);
  const [diagrammart, setDiagrammart] = useDiagrammart();
  const auditLabel = useAuditLabel();

  // Alle vier ausgewählt heißt „kein Filter" — dann rechnet die Datenbank mit
  // ihrer eigenen Liste, und ein fünfter Code dort wirkt sofort.
  const filter = arten.length === AUDIT_ARTEN.length ? null : arten;

  const summe = useQuery({
    queryKey: ["kpi", "qualitaet", "audits", von, bis, filter],
    queryFn: () => qualitaetApi.audits(von, bis, filter),
  });
  const vergleich = useVergleich(["kpi", "qualitaet", "audits", filter], zeitraum, von, bis, (v, b) =>
    qualitaetApi.audits(v, b, filter),
  );
  const verlauf = useQuery({
    queryKey: ["kpi", "qualitaet", "verlauf", von, bis, filter],
    queryFn: () => qualitaetApi.verlauf(von, bis, filter),
  });
  const liste = useQuery({
    queryKey: ["kpi", "qualitaet", "auditListe", von, bis, filter],
    queryFn: () => qualitaetApi.liste(von, bis, filter),
  });
  const zielL1 = zielNach["qualitaet_audit_level1"];
  const zielL2 = zielNach["qualitaet_audit_level2"];

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      verlaufJeBucket(verlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        level_1: p.level_1,
        level_2: p.level_2,
      })),
    [verlaufDaten, t, fmt],
  );
  const findings = liste.data ?? KEINE;
  const diagnose = useMemo(() => ohneLevel(liste.data ?? KEINE), [liste.data]);

  const keineDaten =
    !summe.isLoading &&
    summe.data?.level_1 === 0 &&
    summe.data?.level_2 === 0 &&
    summe.data?.ohne_level === 0;

  const datum = (iso: string) => new Date(iso).toLocaleDateString(tag);
  const spalten: Tabellenspalte<AuditFinding>[] = [
    { schluessel: "report_nr", titel: worte.qualitaet.nr, typ: "text", wert: (z) => z.report_nr, className: "font-mono text-xs" },
    { schluessel: "report_date", titel: worte.qualitaet.datum, typ: "datum", wert: (z) => z.report_date, zelle: (z) => datum(z.report_date), className: "tabular-nums whitespace-nowrap" },
    { schluessel: "art", titel: worte.qualitaet.kategorie, typ: "text", wert: (z) => (z.art ? (auditLabel[z.art] ?? z.art) : null) },
    { schluessel: "level", titel: worte.qualitaet.level, typ: "zahl", wert: (z) => z.level, zelle: (z) => (z.level == null ? "—" : `L${z.level}`) },
    { schluessel: "issuer", titel: worte.qualitaet.aussteller, typ: "text", wert: (z) => z.issuer },
    quelleSpalte(worte.qualitaet.quelle),
    { schluessel: "designation", titel: worte.qualitaet.bezeichnung, typ: "text", wert: (z) => z.designation, className: "max-w-md truncate" },
    statusSpalte(worte.qualitaet.status),
  ];
  const diagnoseSpalten: Tabellenspalte<AuditFinding>[] = [
    { schluessel: "report_nr", titel: worte.qualitaet.bericht, typ: "text", wert: (z) => z.report_nr, className: "font-mono text-xs" },
    { schluessel: "report_date", titel: worte.qualitaet.datum, typ: "datum", wert: (z) => z.report_date, zelle: (z) => datum(z.report_date), className: "tabular-nums" },
    { schluessel: "art", titel: worte.qualitaet.art, typ: "text", wert: (z) => (z.art ? (auditLabel[z.art] ?? z.art) : null) },
    { schluessel: "customer_name", titel: worte.qualitaet.adresse, typ: "text", wert: (z) => z.customer_name },
    { schluessel: "designation", titel: worte.qualitaet.bezeichnung, typ: "text", wert: (z) => z.designation, className: "max-w-md truncate" },
  ];

  return (
    <>
      <Ladefehler fehler={summe.error ?? verlauf.error ?? liste.error} />

      {arten.length === 0 && (
        <Card className="p-4 text-sm text-[var(--fg-muted)]">{worte.qualitaet.keineArt}</Card>
      )}

      {keineDaten && arten.length > 0 && (
        <Card className="p-8 text-center">
          <p className="font-medium">{worte.qualitaet.keineDaten}</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.qualitaet.ladeVor}
            <Link href="/uploads" className="underline underline-offset-4">
              {worte.pfad.seiten["/uploads"]}
            </Link>
            {worte.qualitaet.ladeNach}
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kennzahl
          titel={worte.qualitaet.level1}
          erklaerung={{ seite: "qualitaet", abschnitt: "Audits" }}
          wert={fmt.zahl(summe.data?.level_1)}
          hinweis={zielL1 == null ? undefined : worte.qualitaet.hoechstens(zielL1)}
          warnung={zielL1 != null && (summe.data?.level_1 ?? 0) > zielL1}
          laedt={summe.isLoading}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.level_1}
              vorperiode={vergleich.vorperiode?.level_1}
              vorjahr={vergleich.vorjahr?.level_1}
              vorperiodeLabel={vergleich.label}
              vorjahrLabel={vergleich.labelVorjahr}
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.qualitaet.level2}
          erklaerung={{ seite: "qualitaet", abschnitt: "Audits" }}
          wert={fmt.zahl(summe.data?.level_2)}
          hinweis={zielL2 == null ? undefined : worte.qualitaet.hoechstens(zielL2)}
          warnung={zielL2 != null && (summe.data?.level_2 ?? 0) > zielL2}
          laedt={summe.isLoading}
          vergleich={
            <Vergleiche
              aktuell={summe.data?.level_2}
              vorperiode={vergleich.vorperiode?.level_2}
              vorjahr={vergleich.vorjahr?.level_2}
              vorperiodeLabel={vergleich.label}
              vorjahrLabel={vergleich.labelVorjahr}
              richtung="weniger_ist_besser"
            />
          }
        />
        <Kennzahl
          titel={worte.qualitaet.ohneLevel}
          erklaerung={{ seite: "qualitaet", abschnitt: "Audits" }}
          wert={fmt.zahl(summe.data?.ohne_level)}
          hinweis={worte.qualitaet.ohneLevelHinweis}
          laedt={summe.isLoading}
        />
      </div>

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <DiagrammKopf titel={worte.qualitaet.auditVerlauf} art={diagrammart} onChange={setDiagrammart} />
          <Zeitverlauf
            daten={chartDaten}
            art={diagrammart}
            ganzzahlig
            reihen={[
              { schluessel: "level_1", name: "Level 1", farbe: "var(--danger, #b4443c)" },
              { schluessel: "level_2", name: "Level 2", farbe: "var(--accent, #2f6f8f)" },
            ]}
          />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 font-medium">{worte.qualitaet.findings}</h2>
        <Datentabelle
          zeilen={findings}
          spalten={spalten}
          zeilenSchluessel={(z) => z.report_nr}
          vorsortierung={{ spalte: "report_date", richtung: "ab" }}
          laedt={liste.isLoading}
          beschriftung={worte.qualitaet.findings}
        />
      </Card>

      {diagnose.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.qualitaet.diagnose}</h2>
          <p className="mb-4 mt-0.5 text-sm text-[var(--fg-muted)]">{worte.qualitaet.diagnoseHinweis}</p>
          <Datentabelle
            zeilen={diagnose}
            spalten={diagnoseSpalten}
            zeilenSchluessel={(z) => z.report_nr}
            vorsortierung={{ spalte: "report_date", richtung: "ab" }}
            beschriftung={worte.qualitaet.diagnose}
          />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reklamationen
// ---------------------------------------------------------------------------

function Reklamationen({
  wahl,
  reklArt,
  setReklArt,
  mengenart,
  setMengenart,
  zielNach,
}: {
  wahl: Zeitraumwahl;
  reklArt: ReklamationsArt;
  setReklArt: (a: ReklamationsArt) => void;
  mengenart: Mengenart;
  setMengenart: (m: Mengenart) => void;
  zielNach: Record<string, number>;
}) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const fmt = useFormate();
  const tag = ZAHL_TAG[useSprache()];
  const { zeitraum, von, bis } = wahl;
  const t = takt(von, bis);
  const [diagrammart, setDiagrammart] = useDiagrammart();
  const reklLabel: Record<ReklamationsArt, string> = {
    kunde: worte.qualitaet.reklKunde,
    intern: worte.qualitaet.reklIntern,
    lieferant: worte.qualitaet.reklLieferant,
    werkbank: worte.qualitaet.reklWerkbank,
  };
  const bezugLabel: Record<ReklamationsArt, string> = {
    kunde: worte.qualitaet.bezugKunde,
    intern: worte.qualitaet.bezugIntern,
    lieferant: worte.qualitaet.bezugLieferant,
    werkbank: worte.qualitaet.bezugWerkbank,
  };
  const mengeLabel: Record<Mengenart, string> = {
    gesamt: worte.qualitaet.mengeGesamt,
    akzeptiert: worte.qualitaet.mengeAkzeptiert,
  };

  const rekl = useQuery({
    queryKey: ["kpi", "qualitaet", "rekl", reklArt, mengenart, von, bis],
    queryFn: () => reklamationApi.quote(reklArt, mengenart, von, bis),
  });
  // Die Reklamationsquote hängt zusätzlich an Art und Mengenart. Der Haken
  // bekommt sie über den Abschluss mit — sie gehören in den Abfrageschlüssel,
  // sonst zeigte ein Wechsel der Art alte Vergleichswerte.
  const vglRekl = useVergleich(
    ["kpi", "qualitaet", "rekl", reklArt, mengenart],
    zeitraum,
    von,
    bis,
    (v, b) => reklamationApi.quote(reklArt, mengenart, v, b),
  );
  const reklVerlauf = useQuery({
    queryKey: ["kpi", "qualitaet", "reklVerlauf", reklArt, mengenart, von, bis],
    queryFn: () => reklamationApi.verlauf(reklArt, mengenart, von, bis),
  });
  // Die Liste folgt der Art, nicht der Mengenart: sie zeigt beide Mengen.
  const liste = useQuery({
    queryKey: ["kpi", "qualitaet", "reklListe", reklArt, von, bis],
    queryFn: () => reklamationApi.liste(reklArt, von, bis),
  });

  const reklVerlaufDaten = reklVerlauf.data;
  const reklChart = useMemo(
    () =>
      (reklVerlaufDaten ?? []).map((p) => ({
        label: fmt.bucket(p.bucket, t),
        // Angezeigt wird On Quality, nicht die Fehlerquote — hoch ist gut.
        onQuality: p.quote == null ? null : onQuality(p.quote)! * 100,
        bezugsmenge: p.bezugsmenge,
      })),
    [reklVerlaufDaten, t, fmt],
  );
  const zielFehlerquote = zielNach[`qualitaet_reklamation_${reklArt}`];
  const zielOnQuality = zielFehlerquote == null ? undefined : (1 - zielFehlerquote) * 100;

  const datum = (iso: string) => new Date(iso).toLocaleDateString(tag);
  const spalten: Tabellenspalte<ReklamationZeile>[] = [
    { schluessel: "report_nr", titel: worte.qualitaet.nr, typ: "text", wert: (z) => z.report_nr, className: "font-mono text-xs" },
    { schluessel: "report_date", titel: worte.qualitaet.datum, typ: "datum", wert: (z) => z.report_date, zelle: (z) => datum(z.report_date), className: "tabular-nums whitespace-nowrap" },
    quelleSpalte(worte.qualitaet.quelle),
    { schluessel: "designation", titel: worte.qualitaet.bezeichnung, typ: "text", wert: (z) => z.designation, className: "max-w-md truncate" },
    { schluessel: "quantity", titel: worte.qualitaet.menge, typ: "zahl", wert: (z) => z.quantity, zelle: (z) => fmt.zahl(z.quantity), ausrichtung: "end" },
    { schluessel: "accepted_quantity", titel: worte.qualitaet.akzMenge, typ: "zahl", wert: (z) => z.accepted_quantity, zelle: (z) => fmt.zahl(z.accepted_quantity), ausrichtung: "end" },
    { schluessel: "issuer", titel: worte.qualitaet.aussteller, typ: "text", wert: (z) => z.issuer },
    statusSpalte(worte.qualitaet.status),
  ];

  return (
    <>
      <Ladefehler fehler={rekl.error ?? reklVerlauf.error ?? liste.error} />

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">{worte.qualitaet.onQuality}</h2>
            <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
              {worte.qualitaet.onQualityHinweis(bezugLabel[reklArt])}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Die Art gilt für Kachel und Liste der ganzen Ansicht: in der Schale
                in der rechten Leiste. Die Mengenart betrifft nur diese Kachel. */}
            <Seitenwerkzeuge kategorie="filter">
              <Werkzeug titel={worte.qualitaet.reklamationsart}>
                {inSchale ? (
                  <Leistenwahl
                    beschriftung={worte.qualitaet.reklamationsart}
                    wert={reklArt}
                    onChange={setReklArt}
                    optionen={(Object.keys(reklLabel) as ReklamationsArt[]).map((a) => [a, reklLabel[a]] as const)}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] p-1">
                    {(Object.keys(reklLabel) as ReklamationsArt[]).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setReklArt(a)}
                        aria-pressed={reklArt === a}
                        className={cn(
                          "rounded px-3 py-1 text-sm transition-colors",
                          reklArt === a
                            ? "bg-[var(--fg)] text-[var(--bg)]"
                            : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
                        )}
                      >
                        {reklLabel[a]}
                      </button>
                    ))}
                  </div>
                )}
              </Werkzeug>
            </Seitenwerkzeuge>
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
              {(Object.keys(mengeLabel) as Mengenart[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMengenart(m)}
                  aria-pressed={mengenart === m}
                  className={cn(
                    "rounded px-3 py-1 text-sm transition-colors",
                    mengenart === m
                      ? "bg-[var(--fg)] text-[var(--bg)]"
                      : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
                  )}
                >
                  {mengeLabel[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Kennzahl
            titel={worte.qualitaet.onQuality}
            erklaerung={{ seite: "qualitaet", abschnitt: "Reklamationsquote" }}
            wert={fmt.prozent(onQuality(rekl.data?.quote ?? null))}
            hinweis={
              zielFehlerquote == null
                ? worte.qualitaet.fehlerquote(fmt.prozent(rekl.data?.quote ?? null))
                : worte.qualitaet.fehlerquoteZiel(
                    fmt.prozent(rekl.data?.quote ?? null),
                    fmt.prozent(1 - zielFehlerquote),
                  )
            }
            warnung={
              zielFehlerquote != null &&
              rekl.data?.quote != null &&
              rekl.data.quote > zielFehlerquote
            }
            laedt={rekl.isLoading}
            vergleich={
              <Vergleiche
                aktuell={onQuality(rekl.data?.quote ?? null)}
                vorperiode={onQuality(vglRekl.vorperiode?.quote ?? null)}
                vorjahr={onQuality(vglRekl.vorjahr?.quote ?? null)}
                vorperiodeLabel={vglRekl.label}
                vorjahrLabel={vglRekl.labelVorjahr}
                richtung="mehr_ist_besser"
              />
            }
          />
          <Kennzahl
            titel={worte.qualitaet.reklamiert}
            erklaerung={{ seite: "qualitaet", abschnitt: "Reklamationsquote" }}
            wert={fmt.zahl(rekl.data?.reklamiert)}
            laedt={rekl.isLoading}
          />
          <Kennzahl
            titel={worte.qualitaet.bezugsmenge}
            erklaerung={{ seite: "qualitaet", abschnitt: "Reklamationsquote" }}
            wert={fmt.zahl(rekl.data?.bezugsmenge)}
            hinweis={rekl.data?.bezugsmenge === 0 ? worte.qualitaet.bezugsmengeNull : undefined}
            laedt={rekl.isLoading}
          />
        </div>

        {(rekl.data?.quote ?? 0) > 1 && (
          <p className="mt-3 text-sm text-[var(--danger)]">{worte.qualitaet.mehrAlsBezogen}</p>
        )}

        {reklChart.length > 0 && (
          <>
            <div className="mt-6 flex justify-end">
              <DiagrammartWahl art={diagrammart} onChange={setDiagrammart} />
            </div>
            <Zeitverlauf
              daten={reklChart}
              art={diagrammart}
              // On Quality gehört zwischen 0 und 100. Ohne feste Achse dehnt
              // Recharts sie bis zum kleinsten Wert, und ein Ausreißer weit
              // unter null macht die ganze Kurve unlesbar.
              bereich={[0, 100]}
              achse={(v) => `${v} %`}
              ziel={zielOnQuality == null ? undefined : { wert: zielOnQuality, text: worte.qualitaet.ziellinie }}
              reihen={[{ schluessel: "onQuality", name: worte.qualitaet.onQuality, farbe: "var(--accent, #2f6f8f)" }]}
              tooltip={(wert, eintrag) => ({
                wert: wert == null ? "—" : `${wert.toFixed(2)} %`,
                name: worte.qualitaet.onQualityBezug(String(eintrag.bezugsmenge ?? 0)),
              })}
            />
          </>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-medium">{worte.qualitaet.reklListe(reklLabel[reklArt])}</h2>
        <Datentabelle
          zeilen={liste.data ?? KEINE}
          spalten={spalten}
          zeilenSchluessel={(z) => z.report_nr}
          vorsortierung={{ spalte: "report_date", richtung: "ab" }}
          laedt={liste.isLoading}
          beschriftung={worte.qualitaet.reklListe(reklLabel[reklArt])}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Qualitätsprüfung
// ---------------------------------------------------------------------------

const PRUEFZIEL: Record<Pruefklasse, string> = {
  gross: "qualitaet_pruefung_gross",
  klein: "qualitaet_pruefung_klein",
  gesamt: "qualitaet_pruefung_gesamt",
};

function Pruefung({
  wahl,
  artikelart,
  zielNach,
}: {
  wahl: Zeitraumwahl;
  artikelart: Artikelart;
  zielNach: Record<string, number>;
}) {
  const worte = useTexte();
  const fmt = useFormate();
  const tag = ZAHL_TAG[useSprache()];
  const queryClient = useQueryClient();
  const { zeitraum, von, bis } = wahl;
  const titel: Record<Pruefklasse, string> = {
    gross: worte.qualitaet.gross,
    klein: worte.qualitaet.klein,
    gesamt: worte.qualitaet.gesamt,
  };
  const klasseLabel: Record<"large" | "small", string> = {
    large: worte.qualitaet.klasseGross,
    small: worte.qualitaet.klasseKlein,
  };

  const mengen = useQuery({
    queryKey: ["kpi", "qualitaet", "mengen", artikelart, von, bis],
    queryFn: () => pruefungApi.mengen(von, bis, artikelart),
  });
  const vergleich = useVergleich(["kpi", "qualitaet", "mengen", artikelart], zeitraum, von, bis, (v, b) =>
    pruefungApi.mengen(v, b, artikelart),
  );
  const verlauf = useQuery({
    queryKey: ["kpi", "qualitaet", "pruefVerlauf", artikelart, von, bis],
    queryFn: () => pruefungApi.verlauf(von, bis, artikelart),
  });
  const buchungen = useQuery({
    queryKey: ["kpi", "qualitaet", "buchungen", artikelart, von, bis],
    queryFn: () => pruefungApi.buchungen(von, bis, artikelart),
  });
  const ausschluss = useMutation({
    mutationFn: ({ id, excluded }: { id: number; excluded: boolean }) =>
      pruefungApi.ausschlussSetzen(id, excluded),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi", "qualitaet"] });
    },
    onError: (err: Error) => toast.error(`Ändern fehlgeschlagen: ${err.message}`),
  });

  // Eine Kachel je Größenklasse. Jede teilt durch ihre eigenen Prüfer-Tage;
  // ohne Ziel steht die Zahl der Prüfer-Tage darunter.
  function pruefKachel(klasse: Pruefklasse) {
    const ziel = zielNach[PRUEFZIEL[klasse]];
    const m = mengen.data;
    return {
      titel: titel[klasse],
      wert: fmt.zahl(m?.[klasse]),
      hinweis:
        ziel != null
          ? worte.qualitaet.mindestens(ziel)
          : m && worte.qualitaet.personentage(fmt.zahl(m[`personentage_${klasse}`])),
      warnung: ziel != null && (m?.[klasse] ?? 0) < ziel,
      laedt: mengen.isLoading,
      vergleich: (
        <Vergleiche
          aktuell={pruefleistungVergleich(m, klasse)}
          vorperiode={pruefleistungVergleich(vergleich.vorperiode, klasse)}
          vorjahr={pruefleistungVergleich(vergleich.vorjahr, klasse)}
          vorperiodeLabel={vergleich.label}
          vorjahrLabel={vergleich.labelVorjahr}
          richtung="mehr_ist_besser"
        />
      ),
    };
  }

  const datum = (iso: string) => new Date(iso).toLocaleDateString(tag);
  const spalten: Tabellenspalte<BuchungsZeile>[] = [
    {
      schluessel: "zaehltMit",
      titel: worte.qualitaet.zaehltMit,
      typ: "text",
      wert: () => null,
      suchtext: false,
      sortierbar: false,
      className: "w-20",
      zelle: (b) => (
        <input
          type="checkbox"
          checked={!b.excluded}
          disabled={ausschluss.isPending}
          aria-label={worte.qualitaet.mitzaehlen(datum(b.pruef_datum))}
          onChange={(e) => ausschluss.mutate({ id: b.id, excluded: !e.target.checked })}
          className="h-4 w-4 accent-[var(--fg)]"
        />
      ),
    },
    { schluessel: "pruef_datum", titel: worte.qualitaet.datum, typ: "datum", wert: (b) => b.pruef_datum, zelle: (b) => datum(b.pruef_datum), className: "tabular-nums" },
    { schluessel: "benutzer", titel: worte.qualitaet.pruefer, typ: "text", wert: (b) => b.benutzer },
    { schluessel: "artikel", titel: worte.qualitaet.artikel, typ: "text", wert: (b) => b.artikel, className: "font-mono text-xs" },
    { schluessel: "bezeichnung", titel: worte.qualitaet.produkt, typ: "text", wert: (b) => b.bezeichnung, className: "max-w-sm truncate" },
    { schluessel: "size_class", titel: worte.qualitaet.groesse, typ: "text", wert: (b) => klasseLabel[b.size_class] },
    { schluessel: "buchungs_menge", titel: worte.qualitaet.menge, typ: "zahl", wert: (b) => b.buchungs_menge, zelle: (b) => fmt.zahl(b.buchungs_menge), ausrichtung: "end" },
    { schluessel: "ausschuss_menge", titel: worte.qualitaet.ausschuss, typ: "zahl", wert: (b) => b.ausschuss_menge, zelle: (b) => fmt.zahl(b.ausschuss_menge), ausrichtung: "end" },
  ];

  return (
    <>
      <Ladefehler fehler={mengen.error ?? verlauf.error ?? buchungen.error} />

      <Card className="p-5">
        <h2 className="font-medium">{worte.qualitaet.geprueft}</h2>
        <p className="mt-0.5 text-sm text-[var(--fg-muted)]">{worte.qualitaet.geprueftHinweis}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Kennzahl
            {...pruefKachel("gross")}
            erklaerung={{ seite: "qualitaet", abschnitt: "Prüfmengen und Ausschuss" }}
          />
          <Kennzahl
            {...pruefKachel("klein")}
            erklaerung={{ seite: "qualitaet", abschnitt: "Prüfmengen und Ausschuss" }}
          />
          <Kennzahl
            {...pruefKachel("gesamt")}
            erklaerung={{ seite: "qualitaet", abschnitt: "Prüfmengen und Ausschuss" }}
          />
        </div>
      </Card>

      {(verlauf.data ?? KEINE).length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          {PRUEFKLASSEN.map((klasse) => (
            <PruefVerlauf
              key={klasse}
              klasse={klasse}
              titel={titel[klasse]}
              punkte={verlauf.data ?? KEINE}
              takt={takt(von, bis)}
              ziel={zielNach[PRUEFZIEL[klasse]]}
            />
          ))}
        </div>
      )}

      <Card className="p-5">
        <h2 className="font-medium">{worte.qualitaet.buchungen}</h2>
        <p className="mb-4 mt-0.5 text-sm text-[var(--fg-muted)]">{worte.qualitaet.buchungenHinweis}</p>
        <Datentabelle
          zeilen={buchungen.data ?? KEINE}
          spalten={spalten}
          zeilenSchluessel={(b) => b.id}
          vorsortierung={{ spalte: "pruef_datum", richtung: "ab" }}
          laedt={buchungen.isLoading}
          beschriftung={worte.qualitaet.buchungen}
        />
      </Card>
    </>
  );
}

/** Der Verlauf einer Größenklasse — mit eigener Balken/Fläche-Wahl. */
function PruefVerlauf({
  klasse,
  titel,
  punkte,
  takt: bucketTakt,
  ziel,
}: {
  klasse: Pruefklasse;
  titel: string;
  punkte: readonly PruefVerlaufPunkt[];
  takt: "day" | "week" | "month";
  ziel: number | undefined;
}) {
  const worte = useTexte();
  const fmt = useFormate();
  const [art, setArt] = useDiagrammart();
  const daten = useMemo(
    () =>
      punkte.map((p) => ({
        label: fmt.bucket(p.bucket, bucketTakt),
        wert: p[klasse],
        personentage: p[`personentage_${klasse}`],
      })),
    [punkte, klasse, bucketTakt, fmt],
  );
  return (
    <Card className="p-5">
      <DiagrammKopf titel={worte.qualitaet.pruefVerlauf(titel)} art={art} onChange={setArt} />
      <Zeitverlauf
        daten={daten}
        art={art}
        ziel={ziel == null ? undefined : { wert: ziel, text: worte.qualitaet.ziellinie }}
        reihen={[{ schluessel: "wert", name: titel, farbe: "var(--accent, #2f6f8f)" }]}
        tooltip={(wert, eintrag) => ({
          wert: fmt.zahl(wert),
          name: `${titel} · ${worte.qualitaet.personentage(fmt.zahl(Number(eintrag.personentage ?? 0)))}`,
        })}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bausteine der Seite
// ---------------------------------------------------------------------------

/** Quelle mit Adressnummer dahinter, wie im Altsystem. */
function quelleSpalte<T extends { customer_name: string | null; customer_id: string | null }>(
  titel: string,
): Tabellenspalte<T> {
  return {
    schluessel: "customer_name",
    titel,
    typ: "text",
    wert: (z) => z.customer_name,
    suchtext: (z) => [z.customer_name, z.customer_id].filter(Boolean).join(" "),
    zelle: (z) => (
      <>
        {z.customer_name ?? "—"}
        {z.customer_id && <span className="ms-1 text-xs text-[var(--fg-muted)]">({z.customer_id})</span>}
      </>
    ),
  };
}

// Die Quelle schreibt den Status als Ampel-Kennung „isignal_flag_<farbe>“.
// Alles andere bleibt als Text stehen, damit nichts verloren geht.
const AMPEL: Record<string, string> = {
  green: "var(--ok, #16a34a)",
  yellow: "#eab308",
  red: "var(--danger, #dc2626)",
};

function statusSpalte<T extends { status_code: string | null }>(titel: string): Tabellenspalte<T> {
  return {
    schluessel: "status_code",
    titel,
    typ: "text",
    wert: (z) => z.status_code,
    zelle: (z) => {
      if (!z.status_code) return "—";
      const farbe = AMPEL[/^isignal_flag_([a-z]+)$/i.exec(z.status_code.trim())?.[1]?.toLowerCase() ?? ""];
      if (!farbe) return <span className="font-mono text-xs">{z.status_code}</span>;
      return (
        <span
          role="img"
          title={z.status_code}
          aria-label={z.status_code}
          className="inline-block h-3 w-3 rounded-full align-middle ring-1 ring-[var(--border)]"
          style={{ backgroundColor: farbe }}
        />
      );
    },
  };
}

function Ladefehler({ fehler }: { fehler: unknown }) {
  const worte = useTexte();
  if (!fehler) return null;
  return (
    <Card className="p-4 text-sm text-[var(--danger)]">
      {worte.dashboard.ladeFehler((fehler as Error).message)}
    </Card>
  );
}

/** Fachliche Umschaltung im Stil der übrigen Segmentwahlen. */
function Segmentwahl<T extends string>({
  beschriftung,
  wert,
  onChange,
  optionen,
}: {
  beschriftung: string;
  wert: T;
  onChange: (wert: T) => void;
  optionen: readonly (readonly [T, string])[];
}) {
  // In der schmalen Leiste eine Auswahlliste; die Knöpfe brächen dort um.
  const inSchale = useInSchale();
  if (inSchale) {
    return <Leistenwahl beschriftung={beschriftung} wert={wert} onChange={onChange} optionen={optionen} />;
  }
  return (
    <div
      role="radiogroup"
      aria-label={beschriftung}
      className="inline-flex flex-wrap rounded-md border border-[var(--border)] p-0.5"
    >
      {optionen.map(([w, text]) => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={wert === w}
          onClick={() => onChange(w)}
          className={cn(
            "rounded px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
            wert === w ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function DiagrammKopf({
  titel,
  art,
  onChange,
}: {
  titel: string;
  art: Diagrammart;
  onChange: (art: Diagrammart) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-medium">{titel}</h2>
      <DiagrammartWahl art={art} onChange={onChange} />
    </div>
  );
}

/**
 * Ein Zeitverlauf als Balken oder Fläche (VER-04B). Mehrere Reihen werden als
 * Fläche nicht gestapelt, fehlende Werte nicht überbrückt. Eine Ziellinie
 * weitet die Achse, damit sie auch über den Werten sichtbar bleibt.
 */
function Zeitverlauf({
  daten,
  reihen,
  art,
  ziel,
  bereich,
  achse,
  tooltip,
  ganzzahlig = false,
}: {
  daten: readonly object[];
  reihen: readonly { schluessel: string; name: string; farbe: string }[];
  art: Diagrammart;
  ziel?: { wert: number; text: string };
  bereich?: [number, number];
  achse?: (wert: number) => string;
  tooltip?: (wert: number | null, eintrag: Record<string, unknown>) => { wert: string; name: string };
  ganzzahlig?: boolean;
}) {
  return (
    <div className="mt-4 h-72">
      <ResponsiveContainer width="100%" height="100%">
        {/* Rechter Rand trägt die Beschriftung der Ziellinie. */}
        <ComposedChart data={daten as object[]} margin={{ top: 8, right: ziel ? 56 : 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--fg-muted)" />
          <YAxis
            domain={bereich}
            allowDataOverflow={bereich !== undefined}
            allowDecimals={!ganzzahlig}
            tick={{ fontSize: 12 }}
            stroke="var(--fg-muted)"
            tickFormatter={achse}
            width={achse ? 56 : 40}
          />
          <Tooltip
            formatter={
              tooltip
                ? (wert, _name, eintrag) => {
                    const text = tooltip(
                      typeof wert === "number" ? wert : null,
                      (eintrag?.payload ?? {}) as Record<string, unknown>,
                    );
                    return [text.wert, text.name] as [string, string];
                  }
                : undefined
            }
          />
          {reihen.length > 1 && <Legend />}
          {ziel && (
            <ReferenceLine
              y={ziel.wert}
              ifOverflow="extendDomain"
              stroke="var(--fg-muted)"
              strokeDasharray="4 4"
              label={{ value: ziel.text, position: "right", fontSize: 11, fill: "var(--fg-muted)" }}
            />
          )}
          {reihen.map((r) =>
            art === "balken" ? (
              <Bar
                key={r.schluessel}
                dataKey={r.schluessel}
                name={r.name}
                fill={r.farbe}
                isAnimationActive={false}
                maxBarSize={48}
              />
            ) : (
              <Area
                key={r.schluessel}
                type="monotone"
                dataKey={r.schluessel}
                name={r.name}
                stroke={r.farbe}
                fill={r.farbe}
                fillOpacity={0.2}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
