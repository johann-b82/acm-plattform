"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  bucketLabel,
  fmt,
  takt,
} from "@/lib/kpi/gemeinsam";
import {
  AUDIT_ARTEN,
  AUDIT_LABEL,
  MENGENART_LABEL,
  REKLAMATION_BEZUG,
  REKLAMATION_LABEL,
  KLASSE_LABEL,
  onQuality,
  pruefungApi,
  qualitaetApi,
  reklamationApi,
  verlaufJeBucket,
  type Mengenart,
  type ReklamationsArt,
} from "@/lib/kpi/qualitaet";
import { ladeZielwerte, nachSchluessel, zielwerteKeys } from "@/lib/zielwerte";
import { Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { Kennzahl } from "@/components/kpi/kennzahl";
import { Zeitraumwahl, useZeitraumwahl } from "@/components/kpi/zeitraumwahl";
import { Vergleiche } from "@/components/kpi/vergleich";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { cn } from "@/lib/cn";



export function QualitaetDashboard() {
  const queryClient = useQueryClient();
  const wahl = useZeitraumwahl();
  const { zeitraum, von, bis } = wahl;
  const [arten, setArten] = useState<string[]>([...AUDIT_ARTEN]);
  const [reklArt, setReklArt] = useState<ReklamationsArt>("kunde");
  const [mengenart, setMengenart] = useState<Mengenart>("gesamt");
  const t = takt(von, bis);

  // Alle vier ausgewählt heißt „kein Filter" — dann rechnet die Datenbank mit
  // ihrer eigenen Liste, und ein fünfter Code dort wirkt sofort.
  const filter = arten.length === AUDIT_ARTEN.length ? null : arten;

  const summe = useQuery({
    queryKey: ["kpi", "qualitaet", "audits", von, bis, filter],
    queryFn: () => qualitaetApi.audits(von, bis, filter),
  });
  const verlauf = useQuery({
    queryKey: ["kpi", "qualitaet", "verlauf", von, bis, filter],
    queryFn: () => qualitaetApi.verlauf(von, bis, filter),
  });
  const ziele = useQuery({ queryKey: zielwerteKeys.alle(), queryFn: ladeZielwerte });
  const zielNach = nachSchluessel(ziele.data ?? []);
  const zielL1 = zielNach["qualitaet_audit_level1"];
  const zielL2 = zielNach["qualitaet_audit_level2"];

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

  const mengen = useQuery({
    queryKey: ["kpi", "qualitaet", "mengen", von, bis],
    queryFn: () => pruefungApi.mengen(von, bis),
  });
  const buchungen = useQuery({
    queryKey: ["kpi", "qualitaet", "buchungen", von, bis],
    queryFn: () => pruefungApi.buchungen(von, bis),
  });
  const ausschluss = useMutation({
    mutationFn: ({ id, excluded }: { id: number; excluded: boolean }) =>
      pruefungApi.ausschlussSetzen(id, excluded),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi", "qualitaet"] });
    },
    onError: (err: Error) => toast.error(`Ändern fehlgeschlagen: ${err.message}`),
  });

  const ohneLevel = useQuery({
    queryKey: ["kpi", "qualitaet", "ohneLevel", von, bis, filter],
    queryFn: () => qualitaetApi.ohneLevel(von, bis, filter),
  });

  const verlaufDaten = verlauf.data;
  const chartDaten = useMemo(
    () =>
      verlaufJeBucket(verlaufDaten ?? []).map((p) => ({
        label: bucketLabel(p.bucket, t),
        "Level 1": p.level_1,
        "Level 2": p.level_2,
      })),
    [verlaufDaten, t],
  );

  const reklVerlaufDaten = reklVerlauf.data;
  const reklChart = useMemo(
    () =>
      (reklVerlaufDaten ?? []).map((p) => ({
        label: bucketLabel(p.bucket, t),
        // Angezeigt wird On Quality, nicht die Fehlerquote — hoch ist gut.
        onQuality: p.quote == null ? null : onQuality(p.quote)! * 100,
        bezugsmenge: p.bezugsmenge,
      })),
    [reklVerlaufDaten, t],
  );
  const zielFehlerquote = zielNach[`qualitaet_reklamation_${reklArt}`];
  const zielOnQuality = zielFehlerquote == null ? undefined : (1 - zielFehlerquote) * 100;

  const zielGross = zielNach["qualitaet_pruefung_gross"];
  const zielKlein = zielNach["qualitaet_pruefung_klein"];
  const buchungsDaten = buchungen.data;
  const buchungsListe = useMemo(() => buchungsDaten ?? [], [buchungsDaten]);

  const diagnoseDaten = ohneLevel.data;
  const diagnose = useMemo(() => diagnoseDaten ?? [], [diagnoseDaten]);

  const keineDaten =
    !summe.isLoading &&
    summe.data?.level_1 === 0 &&
    summe.data?.level_2 === 0 &&
    summe.data?.ohne_level === 0;
  const fehler =
    summe.error ??
    verlauf.error ??
    ohneLevel.error ??
    ziele.error ??
    rekl.error ??
    reklVerlauf.error ??
    mengen.error ??
    buchungen.error;

  function umschalten(art: string) {
    setArten((vorher) =>
      vorher.includes(art) ? vorher.filter((a) => a !== art) : [...vorher, art],
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/kpi"
            className="inline-flex items-center gap-1 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <ArrowLeft className="h-4 w-4" /> KPI-Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Qualität</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Audit-Findings, Reklamationsquote und Prüfmengen.
          </p>
        </div>
        <Zeitraumwahl wahl={wahl} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--fg-muted)]">Auditart:</span>
        {AUDIT_ARTEN.map((art) => (
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
            {AUDIT_LABEL[art]}
          </button>
        ))}
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Kennzahlen konnten nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      {arten.length === 0 && (
        <Card className="p-4 text-sm text-[var(--fg-muted)]">
          Keine Auditart ausgewählt. Wähle mindestens eine, sonst gibt es nichts zu zählen.
        </Card>
      )}

      {keineDaten && arten.length > 0 && (
        <Card className="p-8 text-center">
          <p className="font-medium">Für diesen Zeitraum liegen keine Audit-Befunde vor</p>
          <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">
            Lade den 8D-Export unter{" "}
            <Link href="/uploads" className="underline underline-offset-4">
              Uploads
            </Link>{" "}
            hoch.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kennzahl
          titel="Audit-Findings Level 1"
          wert={fmt.zahl(summe.data?.level_1)}
          hinweis={zielL1 == null ? undefined : `Höchstens ${zielL1}`}
          warnung={zielL1 != null && (summe.data?.level_1 ?? 0) > zielL1}
          laedt={summe.isLoading}
        />
        <Kennzahl
          titel="Audit-Findings Level 2"
          wert={fmt.zahl(summe.data?.level_2)}
          hinweis={zielL2 == null ? undefined : `Höchstens ${zielL2}`}
          warnung={zielL2 != null && (summe.data?.level_2 ?? 0) > zielL2}
          laedt={summe.isLoading}
        />
        <Kennzahl
          titel="Ohne erkennbares Level"
          wert={fmt.zahl(summe.data?.ohne_level)}
          hinweis="zählt in keiner Kachel"
          laedt={summe.isLoading}
        />
      </div>

      {chartDaten.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">Audit-Findings im Zeitverlauf</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDaten} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--fg-muted)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--fg-muted)" width={40} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Level 1" fill="var(--danger, #b4443c)" isAnimationActive={false} maxBarSize={48} />
                <Bar dataKey="Level 2" fill="var(--accent, #2f6f8f)" isAnimationActive={false} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">On Quality</h2>
            <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
              Anteil der Menge ohne Beanstandung. Bezugsgröße:{" "}
              {REKLAMATION_BEZUG[reklArt]}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
              {(Object.keys(REKLAMATION_LABEL) as ReklamationsArt[]).map((a) => (
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
                  {REKLAMATION_LABEL[a]}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
              {(Object.keys(MENGENART_LABEL) as Mengenart[]).map((m) => (
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
                  {MENGENART_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Kennzahl
            titel="On Quality"
            wert={fmt.prozent(onQuality(rekl.data?.quote ?? null))}
            hinweis={
              zielFehlerquote == null
                ? `Fehlerquote: ${fmt.prozent(rekl.data?.quote ?? null)}`
                : `Fehlerquote: ${fmt.prozent(rekl.data?.quote ?? null)} · Ziel ${fmt.prozent(1 - zielFehlerquote)}`
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
              />
            }
          />
          <Kennzahl
            titel="Reklamierte Menge"
            wert={fmt.zahl(rekl.data?.reklamiert)}
            laedt={rekl.isLoading}
          />
          <Kennzahl
            titel="Bezugsmenge"
            wert={fmt.zahl(rekl.data?.bezugsmenge)}
            hinweis={rekl.data?.bezugsmenge === 0 ? "ohne sie gibt es keine Quote" : undefined}
            laedt={rekl.isLoading}
          />
        </div>

        {(rekl.data?.quote ?? 0) > 1 && (
          <p className="mt-3 text-sm text-[var(--danger)]">
            Es ist mehr reklamiert als bezogen worden. Das kann die Rechnung nicht auflösen:
            Zähler und Nenner kommen aus verschiedenen Dateien mit eigenen Datumsfeldern. Prüfe,
            ob die Bezugsdatei für diesen Zeitraum vollständig hochgeladen ist.
          </p>
        )}

        {reklChart.length > 0 && (
          <div className="mt-6 h-72">
            <ResponsiveContainer width="100%" height="100%">
              {/* Rechter Rand trägt die Beschriftung der Ziellinie. */}
              <LineChart data={reklChart} margin={{ top: 8, right: 56, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--fg-muted)" />
                <YAxis
                  domain={[0, 100]}
                  // Ohne das dehnt Recharts die Achse bis zum kleinsten Wert;
                  // ein einzelner Ausreißer weit unter null macht dann die
                  // ganze Kurve unlesbar. On Quality gehört zwischen 0 und 100.
                  allowDataOverflow
                  tick={{ fontSize: 12 }}
                  stroke="var(--fg-muted)"
                  tickFormatter={(v: number) => `${v} %`}
                  width={56}
                />
                <Tooltip
                  formatter={(wert, _name, eintrag) => {
                    const zahl = typeof wert === "number" ? wert : null;
                    const menge =
                      (eintrag?.payload as { bezugsmenge?: number } | undefined)?.bezugsmenge ?? 0;
                    return [
                      zahl == null ? "—" : `${zahl.toFixed(2)} %`,
                      `On Quality (Bezug ${menge})`,
                    ] as [string, string];
                  }}
                />
                {zielOnQuality != null && (
                  <ReferenceLine
                    y={zielOnQuality}
                    stroke="var(--fg-muted)"
                    strokeDasharray="4 4"
                    label={{ value: "Ziel", position: "right", fontSize: 11, fill: "var(--fg-muted)" }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="onQuality"
                  stroke="var(--accent, #2f6f8f)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-medium">Geprüfte Produkte</h2>
        <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
          Menge je Prüfer und Prüftag. Der Teiler ist für beide Größen derselbe:{" "}
          {mengen.data?.pruefer ?? 0} Prüfer an {mengen.data?.prueftage ?? 0} Tagen.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Kennzahl
            titel="Große Produkte"
            wert={fmt.zahl(mengen.data?.gross)}
            hinweis={zielGross == null ? undefined : `Mindestens ${zielGross} je Tag und Prüfer`}
            warnung={zielGross != null && (mengen.data?.gross ?? 0) < zielGross}
            laedt={mengen.isLoading}
          />
          <Kennzahl
            titel="Kleine Produkte"
            wert={fmt.zahl(mengen.data?.klein)}
            hinweis={zielKlein == null ? undefined : `Mindestens ${zielKlein} je Tag und Prüfer`}
            warnung={zielKlein != null && (mengen.data?.klein ?? 0) < zielKlein}
            laedt={mengen.isLoading}
          />
        </div>
      </Card>

      {buchungsListe.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">Buchungen der Qualitätsprüfung</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Eine abgewählte Buchung bleibt stehen, zählt aber in keiner Kachel. Größte Menge
            zuerst, höchstens 500 Zeilen.
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th className="w-20">Zählt mit</Th>
                  <Th>Datum</Th>
                  <Th>Prüfer</Th>
                  <Th>Produkt</Th>
                  <Th>Größe</Th>
                  <Th className="text-right">Menge</Th>
                  <Th className="text-right">Ausschuss</Th>
                </tr>
              </thead>
              <tbody>
                {buchungsListe.map((b) => (
                  <tr key={b.id}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={!b.excluded}
                        disabled={ausschluss.isPending}
                        aria-label={`Buchung vom ${new Date(b.pruef_datum).toLocaleDateString("de-DE")} mitzählen`}
                        onChange={(e) =>
                          ausschluss.mutate({ id: b.id, excluded: !e.target.checked })
                        }
                        className="h-4 w-4 accent-[var(--fg)]"
                      />
                    </Td>
                    <Td className="tabular-nums">
                      {new Date(b.pruef_datum).toLocaleDateString("de-DE")}
                    </Td>
                    <Td>{b.benutzer ?? "—"}</Td>
                    <Td className="max-w-sm truncate">{b.bezeichnung ?? "—"}</Td>
                    <Td>{KLASSE_LABEL[b.size_class]}</Td>
                    <Td className="text-right tabular-nums">{fmt.zahl(b.buchungs_menge)}</Td>
                    <Td className="text-right tabular-nums">{fmt.zahl(b.ausschuss_menge)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {diagnose.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">Befunde ohne erkennbares Level</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Das Level steht in der Quelldatei im Freitext. Steht dort weder {"„Major … Level 1“"} noch{" "}
            {"„Minor … Level 2“"}, zählt der Befund nirgends. Diese Liste zeigt, wo nachzubessern ist.
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>Bericht</Th>
                  <Th>Datum</Th>
                  <Th>Art</Th>
                  <Th>Adresse</Th>
                  <Th>Bezeichnung</Th>
                </tr>
              </thead>
              <tbody>
                {diagnose.map((z) => (
                  <tr key={z.report_nr}>
                    <Td className="font-mono text-xs">{z.report_nr}</Td>
                    <Td className="tabular-nums">
                      {new Date(z.report_date).toLocaleDateString("de-DE")}
                    </Td>
                    <Td>{z.art ? (AUDIT_LABEL[z.art] ?? z.art) : "—"}</Td>
                    <Td>{z.customer_name ?? "—"}</Td>
                    <Td className="max-w-md truncate">{z.designation ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
