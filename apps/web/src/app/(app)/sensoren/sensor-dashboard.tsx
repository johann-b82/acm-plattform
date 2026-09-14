"use client";

import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, RefreshCw } from "lucide-react";
import {
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
  FENSTER,
  ausserhalb,
  farbeVon,
  sensorApi,
  sensorKeys,
  zustand,
  type Kennzahlen,
  type Messung,
  type Sensor,
  type SensorEinstellungen,
  type Stand,
  type Zustand,
} from "@/lib/sensoren";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { Seitenwerkzeuge, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { Leistenwahl } from "@/components/sidebar/leistenwahl";
import type { Texte } from "@/texte";

/** Solange die Einstellung nicht geladen ist, gilt die Vorgabe der Migration. */
const VORGABE_TAKT = 3600;

function zahl(wert: string | null | undefined): number | null {
  if (wert === null || wert === undefined) return null;
  const n = Number(wert);
  return Number.isFinite(n) ? n : null;
}

function fensterText(stunden: number, worte: Texte): string {
  return stunden < 72 ? worte.sensoren.stunden(stunden) : worte.sensoren.tage(stunden / 24);
}

/**
 * Was die Geräte gerade melden, und wie es dahin kam.
 *
 * Der Stand kommt aus einer Sicht, nicht aus einer Abfrage je Gerät: letzter
 * Messwert und letzter Versuch stehen dort nebeneinander. Das ist der
 * Unterschied zwischen „meldet gerade nichts" und „ist seit einer Stunde
 * weg" — ohne den zweiten Teil sieht ein stiller Ausfall aus wie Ruhe.
 *
 * Ein Zeitraum für alles (SEN-03/SEN-04): Min/Max der Kacheln und beide
 * Verläufe hängen an derselben Auswahl.
 */
export function SensorDashboard() {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [stunden, setStunden] = useState<number>(24);

  const sensoren = useQuery({ queryKey: sensorKeys.liste(), queryFn: sensorApi.liste });
  const einstellungen = useQuery({
    queryKey: sensorKeys.einstellungen(),
    queryFn: sensorApi.einstellungen,
  });
  const stand = useQuery({
    queryKey: sensorKeys.stand(),
    queryFn: sensorApi.stand,
    refetchInterval: 60_000,
  });
  const kennzahlen = useQuery({
    queryKey: sensorKeys.kennzahlen(stunden),
    queryFn: () => sensorApi.kennzahlen(stunden),
    refetchInterval: 60_000,
  });
  const verlauf = useQuery({
    queryKey: sensorKeys.verlauf(stunden),
    queryFn: () => sensorApi.verlauf(stunden),
    refetchInterval: 300_000,
  });

  const messen = useMutation({
    mutationFn: sensorApi.messen,
    onSuccess: (e) => {
      toast.success(
        e.gemessen === 0
          ? "Kein Gerät hat geantwortet."
          : `${e.gemessen} gemessen${e.gescheitert ? `, ${e.gescheitert} ohne Antwort` : ""}.`,
      );
      for (const hinweis of e.hinweise) toast.error(hinweis);
      return queryClient.invalidateQueries({ queryKey: ["sensoren"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const liste = useMemo(
    () => (sensoren.data ?? []).filter((s) => s.aktiv),
    [sensoren.data],
  );
  const standNach = useMemo(() => {
    const m = new Map<string, Stand>();
    for (const s of stand.data ?? []) m.set(s.sensor_id, s);
    return m;
  }, [stand.data]);
  const kennzahlNach = useMemo(() => {
    const m = new Map<string, Kennzahlen>();
    for (const k of kennzahlen.data ?? []) m.set(k.sensor_id, k);
    return m;
  }, [kennzahlen.data]);

  const grenzen = einstellungen.data ?? null;
  const takt = grenzen?.abfrage_sekunden ?? VORGABE_TAKT;
  const hinweis = stunden <= 24 ? worte.sensoren.mittelFuenfMinuten : worte.sensoren.mittelStunde;

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.sensoren.einleitung}
        bedienung={
          <>
            {/* Das Fenster ist der Zeitraum dieser Seite: in der Schale unter „Zeitraum“. */}
            <Seitenwerkzeuge kategorie="zeitraum">
              <Fensterwahl stunden={stunden} onChange={setStunden} />
            </Seitenwerkzeuge>
            <Button variant="outline" onClick={() => messen.mutate()} disabled={messen.isPending}>
              <RefreshCw
                className={cn("me-2 h-4 w-4", messen.isPending && "animate-spin")}
                aria-hidden
              />
              {messen.isPending ? worte.sensoren.misst : worte.sensoren.jetztMessen}
            </Button>
          </>
        }
      />

      {sensoren.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title={worte.sensoren.keinGeraet}
          body={worte.sensoren.keinGeraetText}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {liste.map((s, i) => (
              <Kachel
                key={s.id}
                sensor={s}
                stand={standNach.get(s.id)}
                kennzahl={kennzahlNach.get(s.id)}
                grenzen={grenzen}
                takt={takt}
                fenster={fensterText(stunden, worte)}
                farbe={farbeVon(s, i)}
              />
            ))}
          </div>

          <Verlaufsdiagramm
            titel={worte.sensoren.temperaturverlauf}
            hinweis={hinweis}
            groesse="temperatur"
            einheit="°C"
            sensoren={liste.filter((s) => s.temperatur_oid)}
            messungen={verlauf.data}
            stunden={stunden}
            laedt={verlauf.isLoading}
            fehler={verlauf.isError}
            min={grenzen?.temperatur_min ?? null}
            max={grenzen?.temperatur_max ?? null}
          />
          <Verlaufsdiagramm
            titel={worte.sensoren.feuchteverlauf}
            hinweis={hinweis}
            groesse="feuchte"
            einheit="%"
            sensoren={liste.filter((s) => s.feuchte_oid)}
            messungen={verlauf.data}
            stunden={stunden}
            laedt={verlauf.isLoading}
            fehler={verlauf.isError}
            min={grenzen?.feuchte_min ?? null}
            max={grenzen?.feuchte_max ?? null}
          />
        </>
      )}
    </div>
  );
}

/** Die Zeitraumwahl als Auswahlliste, im Stil der Kennzahlenseiten (KPI-07). */
function Fensterwahl({ stunden, onChange }: { stunden: number; onChange: (s: number) => void }) {
  const worte = useTexte();
  const id = useId();
  // In der Leiste so breit wie die Leiste, der Pfeil im Feld — wie die übrigen
  // Auswahllisten dort. Die feste Breite passte nur neben den Knöpfen im Kopf.
  const inSchale = useInSchale();
  if (inSchale) {
    return (
      <Leistenwahl
        beschriftung={worte.zeitraum.aria}
        wert={String(stunden)}
        onChange={(w) => onChange(Number(w))}
        optionen={FENSTER.map((f) => [String(f), fensterText(f, worte)] as const)}
      />
    );
  }
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {worte.zeitraum.aria}
      </label>
      <select
        id={id}
        value={stunden}
        onChange={(e) => onChange(Number(e.target.value))}
        className={
          "h-9 w-48 cursor-pointer appearance-none rounded-md border border-[var(--border)] " +
          "bg-[var(--surface)] px-2 pe-8 text-sm font-medium focus-visible:outline-2 " +
          "focus-visible:outline-[var(--ring)]"
        }
      >
        {FENSTER.map((f) => (
          <option key={f} value={f}>
            {fensterText(f, worte)}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-muted)]"
        aria-hidden
      />
    </div>
  );
}

function Kachel({
  sensor,
  stand,
  kennzahl,
  grenzen,
  takt,
  fenster,
  farbe,
}: {
  sensor: Sensor;
  stand: Stand | undefined;
  kennzahl: Kennzahlen | undefined;
  grenzen: SensorEinstellungen | null;
  takt: number;
  fenster: string;
  farbe: string;
}) {
  const worte = useTexte();
  const tag = ZAHL_TAG[useSprache()];
  const ZEIT = new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" });
  const zustandText: Record<Zustand, string> = {
    frisch: worte.sensoren.frisch,
    verzoegert: worte.sensoren.verzoegert,
    offline: worte.sensoren.offline,
    unbekannt: worte.sensoren.unbekannt,
  };
  const zust = zustand(stand, takt);
  const temperatur = zahl(stand?.temperatur);
  const feuchte = zahl(stand?.feuchte);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: farbe }}
        />
        <h2 className="min-w-0 truncate font-medium" title={sensor.name}>
          {sensor.name}
        </h2>
        <Badge
          variant={zust === "frisch" ? "secondary" : "outline"}
          className="ms-auto"
        >
          {zustandText[zust]}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {sensor.temperatur_oid && (
          <Wert
            label={worte.sensoren.temperatur}
            wert={temperatur}
            einheit="°C"
            stellen={1}
            warnt={ausserhalb(temperatur, grenzen?.temperatur_min ?? null, grenzen?.temperatur_max ?? null)}
            min={zahl(kennzahl?.temperatur_min)}
            max={zahl(kennzahl?.temperatur_max)}
            fenster={fenster}
          />
        )}
        {sensor.feuchte_oid && (
          <Wert
            label={worte.sensoren.luftfeuchte}
            wert={feuchte}
            einheit="%"
            stellen={0}
            warnt={ausserhalb(feuchte, grenzen?.feuchte_min ?? null, grenzen?.feuchte_max ?? null)}
            min={zahl(kennzahl?.feuchte_min)}
            max={zahl(kennzahl?.feuchte_max)}
            fenster={fenster}
          />
        )}
      </div>

      <p className="truncate text-xs text-[var(--fg-muted)]" title={stand?.fehler ?? undefined}>
        {stand?.gemessen_am
          ? worte.sensoren.zuletzt(ZEIT.format(new Date(stand.gemessen_am)))
          : worte.sensoren.keinMesswert}
        {stand?.erfolg === false && stand.fehler && ` · ${stand.fehler}`}
      </p>
    </Card>
  );
}

function Wert({
  label,
  wert,
  einheit,
  stellen,
  warnt,
  min,
  max,
  fenster,
}: {
  label: string;
  wert: number | null;
  einheit: string;
  stellen: number;
  warnt: boolean;
  min: number | null;
  max: number | null;
  fenster: string;
}) {
  const worte = useTexte();
  const tag = ZAHL_TAG[useSprache()];
  const format = (n: number) =>
    new Intl.NumberFormat(tag, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(n);
  const minMax = `${worte.sensoren.minMax(fenster)}: ${
    min === null || max === null ? "—" : `${format(min)} – ${format(max)} ${einheit}`
  }`;

  return (
    <div className="min-w-0">
      <div className="truncate text-xs uppercase tracking-wide text-[var(--fg-muted)]">{label}</div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          warnt && "text-[var(--danger)]",
        )}
      >
        {wert === null ? "—" : `${format(wert)} ${einheit}`}
      </div>
      {warnt && (
        <div className="truncate text-xs text-[var(--danger)]">{worte.sensoren.ausserhalbGrenzen}</div>
      )}
      {/* UI-01: je eine Zeile, der volle Text steht im Titel. */}
      <div className="mt-1 truncate text-xs text-[var(--fg-muted)] tabular-nums" title={minMax}>
        {minMax}
      </div>
    </div>
  );
}

/**
 * Ein Diagramm je Größe, eine Linie je Gerät. Recharts braucht eine Zeile je
 * Zeitpunkt mit einer Spalte je Gerät; zusammengelegt wird über den
 * Zeitstempel. Wo ein Gerät fehlt, bleibt die Spalte leer und die Linie
 * bekommt eine Lücke, statt quer über den Ausfall hinwegzuziehen.
 */
function Verlaufsdiagramm({
  titel,
  hinweis,
  groesse,
  einheit,
  sensoren,
  messungen,
  stunden,
  laedt,
  fehler,
  min,
  max,
}: {
  titel: string;
  hinweis: string;
  groesse: "temperatur" | "feuchte";
  einheit: string;
  sensoren: Sensor[];
  messungen: Messung[] | undefined;
  stunden: number;
  laedt: boolean;
  fehler: boolean;
  min: number | null;
  max: number | null;
}) {
  const worte = useTexte();
  const tag = ZAHL_TAG[useSprache()];
  const UHR = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" });
  const TAG_UHR = new Intl.DateTimeFormat(tag, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ZEIT = new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" });
  const WERT = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const daten = useMemo(() => {
    const zeilen = new Map<number, Record<string, number | null>>();
    for (const m of messungen ?? []) {
      const zeit = new Date(m.zeit).getTime();
      const zeile = zeilen.get(zeit) ?? { zeit };
      zeile[m.sensor_id] = zahl(m[groesse]);
      zeilen.set(zeit, zeile);
    }
    return [...zeilen.values()].sort((a, b) => (a.zeit ?? 0) - (b.zeit ?? 0));
  }, [messungen, groesse]);

  const beschriftung = stunden <= 24 ? UHR : TAG_UHR;
  const spanne = groesse === "temperatur" ? 2 : 5;

  return (
    <Card className="p-5">
      <h2 className="font-medium">{titel}</h2>
      <p className="text-xs text-[var(--fg-muted)]">{hinweis}</p>
      {laedt ? (
        <p className="mt-4 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</p>
      ) : fehler ? (
        <p className="mt-4 text-sm text-[var(--danger)]">{worte.sensoren.ladeFehler}</p>
      ) : daten.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--fg-muted)]">{worte.sensoren.nichtsGemessen}</p>
      ) : (
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daten} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="zeit"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tick={{ fontSize: 12 }}
                stroke="var(--fg-muted)"
                tickFormatter={(v: number) => beschriftung.format(new Date(v))}
              />
              <YAxis
                // Enger Ausschnitt statt Skala ab null: bei Raumtemperatur ist
                // der Unterschied zwischen 19 und 24 Grad die ganze Geschichte.
                domain={[`dataMin - ${spanne}`, `dataMax + ${spanne}`]}
                tick={{ fontSize: 12 }}
                stroke="var(--fg-muted)"
                width={56}
                tickFormatter={(v: number) => `${Math.round(v)} ${einheit}`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(label) =>
                  typeof label === "number" ? ZEIT.format(new Date(label)) : ""
                }
                formatter={(wert, name) => [
                  typeof wert === "number" ? `${WERT.format(wert)} ${einheit}` : "—",
                  sensoren.find((s) => s.id === name)?.name ?? String(name),
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(name) => sensoren.find((s) => s.id === name)?.name ?? String(name)}
              />
              {min !== null && (
                <ReferenceLine
                  y={min}
                  stroke="var(--danger)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{ value: worte.sensoren.untergrenze, position: "insideTopRight", fontSize: 11, fill: "var(--danger)" }}
                />
              )}
              {max !== null && (
                <ReferenceLine
                  y={max}
                  stroke="var(--danger)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{ value: worte.sensoren.obergrenze, position: "insideTopRight", fontSize: 11, fill: "var(--danger)" }}
                />
              )}
              {sensoren.map((s, i) => (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={s.id}
                  name={s.id}
                  stroke={farbeVon(s, i)}
                  strokeWidth={2}
                  // Bei wenigen Punkten (1 h bei stündlichem Takt) wäre eine
                  // Linie ohne Punkte unsichtbar.
                  dot={daten.length <= 2 ? { r: 3 } : false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
