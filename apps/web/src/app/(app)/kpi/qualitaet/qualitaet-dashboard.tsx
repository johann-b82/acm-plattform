"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  takt,
} from "@/lib/kpi/gemeinsam";
import {
  AUDIT_ARTEN,
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
import { Datenstand } from "@/components/kpi/datenstand";
import { Seitenkopf } from "@/components/seitenkopf";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { ZAHL_TAG } from "@/lib/sprache";
import { useVergleich } from "@/lib/kpi/use-vergleich";
import { cn } from "@/lib/cn";



export function QualitaetDashboard() {
  const worte = useTexte();
  const fmt = useFormate();
  const tag = ZAHL_TAG[useSprache()];
  // Die Schlüssel kommen aus der Datenbank, die Namen aus dem Wörterbuch.
  const auditLabel: Record<string, string> = {
    "BH AUD": worte.qualitaet.behoerde,
    "EX AUD": worte.qualitaet.extern,
    "IN AUD": worte.qualitaet.intern,
    "KU AUD": worte.qualitaet.kunde,
  };
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
  const klasseLabel: Record<"large" | "small", string> = {
    large: worte.qualitaet.klasseGross,
    small: worte.qualitaet.klasseKlein,
  };
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
        label: fmt.bucket(p.bucket, t),
        "Level 1": p.level_1,
        "Level 2": p.level_2,
      })),
    [verlaufDaten, t, fmt],
  );

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
      <Seitenkopf
        untertitel={worte.qualitaet.einleitung}
        unter={<Datenstand bereich="qualitaet" />}
        bedienung={<Zeitraumwahl wahl={wahl} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--fg-muted)]">{worte.qualitaet.auditart}</span>
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
            {auditLabel[art]}
          </button>
        ))}
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          {worte.dashboard.ladeFehler((fehler as Error).message)}
        </Card>
      )}

      {arten.length === 0 && (
        <Card className="p-4 text-sm text-[var(--fg-muted)]">
          {worte.qualitaet.keineArt}
        </Card>
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
        />
        <Kennzahl
          titel={worte.qualitaet.level2}
          erklaerung={{ seite: "qualitaet", abschnitt: "Audits" }}
          wert={fmt.zahl(summe.data?.level_2)}
          hinweis={zielL2 == null ? undefined : worte.qualitaet.hoechstens(zielL2)}
          warnung={zielL2 != null && (summe.data?.level_2 ?? 0) > zielL2}
          laedt={summe.isLoading}
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
          <h2 className="font-medium">{worte.qualitaet.auditVerlauf}</h2>
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
            <h2 className="font-medium">{worte.qualitaet.onQuality}</h2>
            <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
              {worte.qualitaet.onQualityHinweis(bezugLabel[reklArt])}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
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
          <p className="mt-3 text-sm text-[var(--danger)]">
            {worte.qualitaet.mehrAlsBezogen}
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
                      worte.qualitaet.onQualityBezug(String(menge)),
                    ] as [string, string];
                  }}
                />
                {zielOnQuality != null && (
                  <ReferenceLine
                    y={zielOnQuality}
                    stroke="var(--fg-muted)"
                    strokeDasharray="4 4"
                    label={{
                      value: worte.qualitaet.ziellinie,
                      position: "right",
                      fontSize: 11,
                      fill: "var(--fg-muted)",
                    }}
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
        <h2 className="font-medium">{worte.qualitaet.geprueft}</h2>
        <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
          {worte.qualitaet.geprueftHinweis(
            String(mengen.data?.pruefer ?? 0),
            String(mengen.data?.prueftage ?? 0),
          )}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Kennzahl
            titel={worte.qualitaet.gross}
            erklaerung={{ seite: "qualitaet", abschnitt: "Prüfmengen und Ausschuss" }}
            wert={fmt.zahl(mengen.data?.gross)}
            hinweis={zielGross == null ? undefined : worte.qualitaet.mindestens(zielGross)}
            warnung={zielGross != null && (mengen.data?.gross ?? 0) < zielGross}
            laedt={mengen.isLoading}
          />
          <Kennzahl
            titel={worte.qualitaet.klein}
            erklaerung={{ seite: "qualitaet", abschnitt: "Prüfmengen und Ausschuss" }}
            wert={fmt.zahl(mengen.data?.klein)}
            hinweis={zielKlein == null ? undefined : worte.qualitaet.mindestens(zielKlein)}
            warnung={zielKlein != null && (mengen.data?.klein ?? 0) < zielKlein}
            laedt={mengen.isLoading}
          />
        </div>
      </Card>

      {buchungsListe.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.qualitaet.buchungen}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.qualitaet.buchungenHinweis}
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th className="w-20">{worte.qualitaet.zaehltMit}</Th>
                  <Th>{worte.qualitaet.datum}</Th>
                  <Th>{worte.qualitaet.pruefer}</Th>
                  <Th>{worte.qualitaet.produkt}</Th>
                  <Th>{worte.qualitaet.groesse}</Th>
                  <Th className="text-end">{worte.qualitaet.menge}</Th>
                  <Th className="text-end">{worte.qualitaet.ausschuss}</Th>
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
                        aria-label={worte.qualitaet.mitzaehlen(
                          new Date(b.pruef_datum).toLocaleDateString(tag),
                        )}
                        onChange={(e) =>
                          ausschluss.mutate({ id: b.id, excluded: !e.target.checked })
                        }
                        className="h-4 w-4 accent-[var(--fg)]"
                      />
                    </Td>
                    <Td className="tabular-nums">
                      {new Date(b.pruef_datum).toLocaleDateString(tag)}
                    </Td>
                    <Td>{b.benutzer ?? "—"}</Td>
                    <Td className="max-w-sm truncate">{b.bezeichnung ?? "—"}</Td>
                    <Td>{klasseLabel[b.size_class]}</Td>
                    <Td className="text-end tabular-nums">{fmt.zahl(b.buchungs_menge)}</Td>
                    <Td className="text-end tabular-nums">{fmt.zahl(b.ausschuss_menge)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {diagnose.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">{worte.qualitaet.diagnose}</h2>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            {worte.qualitaet.diagnoseHinweis}
          </p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>{worte.qualitaet.bericht}</Th>
                  <Th>{worte.qualitaet.datum}</Th>
                  <Th>{worte.qualitaet.art}</Th>
                  <Th>{worte.qualitaet.adresse}</Th>
                  <Th>{worte.qualitaet.bezeichnung}</Th>
                </tr>
              </thead>
              <tbody>
                {diagnose.map((z) => (
                  <tr key={z.report_nr}>
                    <Td className="font-mono text-xs">{z.report_nr}</Td>
                    <Td className="tabular-nums">
                      {new Date(z.report_date).toLocaleDateString("de-DE")}
                    </Td>
                    <Td>{z.art ? (auditLabel[z.art] ?? z.art) : "—"}</Td>
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
