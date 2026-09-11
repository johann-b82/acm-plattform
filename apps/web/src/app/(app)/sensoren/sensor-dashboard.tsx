"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import {
  CartesianGrid,
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
  type Messung,
  type Sensor,
  type Stand,
  type Zustand,
} from "@/lib/sensoren";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";





function zahl(wert: string | null): number | null {
  if (wert === null) return null;
  const n = Number(wert);
  return Number.isFinite(n) ? n : null;
}

/**
 * Was die Geräte gerade melden, und wie es dahin kam.
 *
 * Der Stand kommt aus einer Sicht, nicht aus einer Abfrage je Gerät: letzter
 * Messwert und letzter Versuch stehen dort nebeneinander. Das ist der
 * Unterschied zwischen „meldet gerade nichts" und „ist seit einer Stunde
 * weg" — ohne den zweiten Teil sieht ein stiller Ausfall aus wie Ruhe.
 */
export function SensorDashboard() {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [stunden, setStunden] = useState<number>(24);

  const sensoren = useQuery({ queryKey: sensorKeys.liste(), queryFn: sensorApi.liste });
  const stand = useQuery({
    queryKey: sensorKeys.stand(),
    queryFn: sensorApi.stand,
    // Der Takt liegt bei fünf Minuten; öfter zu fragen bringt keinen neuen Wert.
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

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.sensoren.einleitung}
        bedienung={
          <Button variant="outline" onClick={() => messen.mutate()} disabled={messen.isPending}>
            <RefreshCw
              className={cn("mr-2 h-4 w-4", messen.isPending && "animate-spin")}
              aria-hidden
            />
            {messen.isPending ? worte.sensoren.misst : worte.sensoren.jetztMessen}
          </Button>
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
                farbe={farbeVon(s, i)}
              />
            ))}
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium">{worte.sensoren.verlauf}</h2>
              <div className="flex gap-1">
                {FENSTER.map((f) => (
                  <Button
                    key={f.stunden}
                    size="sm"
                    variant={f.stunden === stunden ? "default" : "outline"}
                    onClick={() => setStunden(f.stunden)}
                  >
                    {f.stunden < 72
                      ? worte.sensoren.stunden(f.stunden)
                      : worte.sensoren.tage(f.stunden / 24)}
                  </Button>
                ))}
              </div>
            </div>
            <Verlauf
              sensoren={liste}
              messungen={verlauf.data ?? []}
              stunden={stunden}
              laedt={verlauf.isLoading}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Kachel({
  sensor,
  stand,
  farbe,
}: {
  sensor: Sensor;
  stand: Stand | undefined;
  farbe: string;
}) {
  const worte = useTexte();
  const tag = SPRACHE_TAG[useSprache()];
  const ZEIT = new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" });
  const zustandText: Record<Zustand, string> = {
    frisch: worte.sensoren.frisch,
    verzoegert: worte.sensoren.verzoegert,
    offline: worte.sensoren.offline,
    unbekannt: worte.sensoren.unbekannt,
  };
  const zust = zustand(stand);
  const temperatur = zahl(stand?.temperatur ?? null);
  const feuchte = zahl(stand?.feuchte ?? null);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: farbe }}
        />
        <h2 className="font-medium">{sensor.name}</h2>
        <Badge
          variant={zust === "frisch" ? "secondary" : "outline"}
          className="ml-auto"
        >
          {zustandText[zust]}
        </Badge>
      </div>

      <div className="flex gap-6">
        {sensor.temperatur_oid && (
          <Wert
            label={worte.sensoren.temperatur}
            wert={temperatur}
            einheit="°C"
            warnt={ausserhalb(temperatur, sensor.temperatur_min, sensor.temperatur_max)}
          />
        )}
        {sensor.feuchte_oid && (
          <Wert
            label={worte.sensoren.luftfeuchte}
            wert={feuchte}
            einheit="%"
            warnt={ausserhalb(feuchte, sensor.feuchte_min, sensor.feuchte_max)}
          />
        )}
      </div>

      <p className="text-xs text-[var(--fg-muted)]">
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
  warnt,
}: {
  label: string;
  wert: number | null;
  einheit: string;
  warnt: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">{label}</div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          warnt && "text-[var(--danger)]",
        )}
      >
        {wert === null ? "—" : `${wert.toFixed(1)} ${einheit}`}
      </div>
    </div>
  );
}

/**
 * Ein Diagramm für alle Geräte. Recharts braucht dafür eine Zeile je
 * Zeitpunkt mit einer Spalte je Gerät — die Messungen kommen aber als lange
 * Liste. Zusammengelegt wird über den Zeitstempel; wo ein Gerät fehlt, bleibt
 * die Spalte leer und die Linie bekommt eine Lücke, statt quer über den
 * Ausfall hinwegzuziehen.
 */
function Verlauf({
  sensoren,
  messungen,
  stunden,
  laedt,
}: {
  sensoren: Sensor[];
  messungen: Messung[];
  stunden: number;
  laedt: boolean;
}) {
  const worte = useTexte();
  const tag = SPRACHE_TAG[useSprache()];
  const UHR = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" });
  const TAG_UHR = new Intl.DateTimeFormat(tag, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ZEIT = new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" });
  const daten = useMemo(() => {
    const zeilen = new Map<number, Record<string, number | null>>();
    for (const m of messungen) {
      const zeit = new Date(m.gemessen_am).getTime();
      const zeile = zeilen.get(zeit) ?? { zeit };
      zeile[m.sensor_id] = zahl(m.temperatur);
      zeilen.set(zeit, zeile);
    }
    return [...zeilen.values()].sort((a, b) => (a.zeit ?? 0) - (b.zeit ?? 0));
  }, [messungen]);

  const grenzen = useMemo(() => {
    const werte = sensoren
      .flatMap((s) => [s.temperatur_min, s.temperatur_max])
      .filter((w): w is string => w !== null)
      .map(Number);
    return werte.length ? { min: Math.min(...werte), max: Math.max(...werte) } : null;
  }, [sensoren]);

  if (laedt) {
    return <p className="mt-4 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</p>;
  }
  if (daten.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--fg-muted)]">
        {worte.sensoren.nichtsGemessen}
      </p>
    );
  }

  const beschriftung = stunden <= 24 ? UHR : TAG_UHR;

  return (
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
            domain={["dataMin - 2", "dataMax + 2"]}
            tick={{ fontSize: 12 }}
            stroke="var(--fg-muted)"
            width={56}
            tickFormatter={(v: number) => `${Math.round(v)} °C`}
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
              typeof wert === "number" ? `${wert.toFixed(1)} °C` : "—",
              sensoren.find((s) => s.id === name)?.name ?? String(name),
            ]}
          />
          {grenzen && (
            <>
              <ReferenceLine
                y={grenzen.min}
                stroke="var(--fg-muted)"
                strokeDasharray="4 4"
              />
              <ReferenceLine
                y={grenzen.max}
                stroke="var(--fg-muted)"
                strokeDasharray="4 4"
              />
            </>
          )}
          {sensoren.map((s, i) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              name={s.id}
              stroke={farbeVon(s, i)}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
