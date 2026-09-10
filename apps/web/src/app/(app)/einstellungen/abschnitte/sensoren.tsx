"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlugZap, Plus } from "lucide-react";

import { sensorApi, sensorKeys, type Sensor } from "@/lib/sensoren";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Switch,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";

/** Was sich an einem angelegten Gerät ändern lässt, in der Reihenfolge der Maske. */
const FELDER: {
  feld: keyof Sensor;
  label: string;
  hinweis?: string;
  breit?: boolean;
}[] = [
  { feld: "name", label: "Name" },
  { feld: "rechner", label: "Rechner", hinweis: "muss in SNMP_ERLAUBT stehen" },
  { feld: "port", label: "Port" },
  { feld: "temperatur_oid", label: "Kennung Temperatur", breit: true },
  { feld: "feuchte_oid", label: "Kennung Luftfeuchte", breit: true },
  {
    feld: "temperatur_faktor",
    label: "Faktor Temperatur",
    hinweis: "0,1 wenn das Gerät Zehntelgrad als ganze Zahl liefert",
  },
  { feld: "feuchte_faktor", label: "Faktor Luftfeuchte" },
  { feld: "temperatur_min", label: "Temperatur ab (°C)" },
  { feld: "temperatur_max", label: "Temperatur bis (°C)" },
  { feld: "feuchte_min", label: "Luftfeuchte ab (%)" },
  { feld: "feuchte_max", label: "Luftfeuchte bis (%)" },
  { feld: "farbe", label: "Farbe im Verlauf", hinweis: "z. B. #0f6e8c" },
];

const ZAHLENFELDER = new Set<keyof Sensor>([
  "port",
  "temperatur_faktor",
  "feuchte_faktor",
  "temperatur_min",
  "temperatur_max",
  "feuchte_min",
  "feuchte_max",
]);

const LEER = {
  name: "",
  rechner: "",
  community: "",
  temperatur_oid: "",
  feuchte_oid: "",
};

/**
 * Die Messgeräte im Netz.
 *
 * Die Community steht nur beim Anlegen in der Maske und kommt nie zurück: das
 * Spaltenrecht gibt sie nicht heraus, und geschrieben wird sie über `compute`,
 * weil nur dort der Schlüssel zum Verschlüsseln liegt. Wer sie ändern will,
 * trägt eine neue ein — angezeigt wird sie nirgends.
 */
export function Sensoren() {
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState({ ...LEER });
  const [probe, setProbe] = useState<string | null>(null);

  const sensoren = useQuery({ queryKey: sensorKeys.liste(), queryFn: sensorApi.liste });
  const liste = sensoren.data ?? [];

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["sensoren"] });

  const anlegen = useMutation({
    mutationFn: () =>
      sensorApi.anlegen({
        name: neu.name.trim(),
        rechner: neu.rechner.trim(),
        community: neu.community,
        temperatur_oid: neu.temperatur_oid.trim() || null,
        feuchte_oid: neu.feuchte_oid.trim() || null,
      }),
    onSuccess: () => {
      setNeu({ ...LEER });
      setProbe(null);
      toast.success("Sensor angelegt.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const ausprobieren = useMutation({
    mutationFn: () =>
      sensorApi.probe({
        rechner: neu.rechner.trim(),
        community: neu.community,
        temperatur_oid: neu.temperatur_oid.trim() || null,
        feuchte_oid: neu.feuchte_oid.trim() || null,
      }),
    onSuccess: (e) =>
      setProbe(
        e.erreichbar
          ? `Gerät antwortet: ${[
              e.temperatur !== null ? `${e.temperatur} (Temperatur)` : null,
              e.feuchte !== null ? `${e.feuchte} (Luftfeuchte)` : null,
            ]
              .filter(Boolean)
              .join(", ")} — noch ohne Faktor.`
          : `Keine Antwort: ${e.meldung ?? "unbekannt"}`,
      ),
    onError: (fehler: Error) => setProbe(`Keine Antwort: ${fehler.message}`),
  });

  const aendern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Record<string, unknown> }) =>
      sensorApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => sensorApi.loeschen(id),
    onSuccess: () => {
      toast.success("Sensor gelöscht, samt Zeitreihe.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const bereit =
    neu.name.trim() &&
    neu.rechner.trim() &&
    neu.community &&
    (neu.temperatur_oid.trim() || neu.feuchte_oid.trim());

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h3 className="font-medium">Neues Gerät</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="neu-name">Name</Label>
            <Input
              id="neu-name"
              value={neu.name}
              placeholder="Serverraum"
              onChange={(e) => setNeu({ ...neu, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="neu-rechner">Rechner</Label>
            <Input
              id="neu-rechner"
              value={neu.rechner}
              placeholder="sensor-01.acm.local"
              onChange={(e) => setNeu({ ...neu, rechner: e.target.value })}
            />
            <span className="text-xs text-[var(--fg-muted)]">
              muss in SNMP_ERLAUBT stehen
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="neu-community">Community</Label>
            <Input
              id="neu-community"
              type="password"
              value={neu.community}
              autoComplete="off"
              onChange={(e) => setNeu({ ...neu, community: e.target.value })}
            />
            <span className="text-xs text-[var(--fg-muted)]">
              wird verschlüsselt abgelegt und nie wieder angezeigt
            </span>
          </div>
          <div className="flex flex-col gap-1 lg:col-span-2">
            <Label htmlFor="neu-temp">Kennung Temperatur</Label>
            <Input
              id="neu-temp"
              value={neu.temperatur_oid}
              placeholder="1.3.6.1.4.1.…"
              onChange={(e) => setNeu({ ...neu, temperatur_oid: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 lg:col-span-2">
            <Label htmlFor="neu-feuchte">Kennung Luftfeuchte</Label>
            <Input
              id="neu-feuchte"
              value={neu.feuchte_oid}
              placeholder="optional"
              onChange={(e) => setNeu({ ...neu, feuchte_oid: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!bereit || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Anlegen
          </Button>
          <Button
            variant="outline"
            disabled={!bereit || ausprobieren.isPending}
            onClick={() => ausprobieren.mutate()}
          >
            <PlugZap className="mr-1.5 h-4 w-4" aria-hidden />
            {ausprobieren.isPending ? "Fragt …" : "Ausprobieren"}
          </Button>
          {probe && <span className="text-sm text-[var(--fg-muted)]">{probe}</span>}
        </div>
      </Card>

      {sensoren.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title="Noch kein Gerät"
          body="Trag oben Rechner, Community und mindestens eine Kennung ein."
        />
      ) : (
        liste.map((s) => (
          <Card key={s.id} className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-medium">{s.name}</h3>
              <div className="ml-auto flex items-center gap-3">
                <Switch
                  checked={s.aktiv}
                  label={`${s.name} wird abgefragt`}
                  onCheckedChange={(aktiv) =>
                    aendern.mutate({ id: s.id, felder: { aktiv } })
                  }
                />
                <span className="text-sm text-[var(--fg-muted)]">
                  {s.aktiv ? "wird abgefragt" : "ruht"}
                </span>
                <ConfirmDeleteButton
                  itemLabel={s.name}
                  onConfirm={() => loeschen.mutateAsync(s.id).then(() => undefined)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FELDER.map(({ feld, label, hinweis, breit }) => (
                <div
                  key={feld}
                  className={breit ? "flex flex-col gap-1 lg:col-span-2" : "flex flex-col gap-1"}
                >
                  <Label htmlFor={`${s.id}-${feld}`}>{label}</Label>
                  <Input
                    id={`${s.id}-${feld}`}
                    defaultValue={(s[feld] as string | number | null) ?? ""}
                    placeholder="—"
                    inputMode={ZAHLENFELDER.has(feld) ? "decimal" : undefined}
                    onBlur={(e) => {
                      const roh = e.target.value.trim();
                      const alt = s[feld] === null ? "" : String(s[feld]);
                      if (roh === alt) return;
                      const wert = ZAHLENFELDER.has(feld)
                        ? roh === ""
                          ? null
                          : Number(roh.replace(",", "."))
                        : roh || null;
                      if (typeof wert === "number" && !Number.isFinite(wert)) {
                        toast.error("Bitte eine Zahl eingeben.");
                        e.target.value = alt;
                        return;
                      }
                      aendern.mutate({ id: s.id, felder: { [feld]: wert } });
                    }}
                  />
                  {hinweis && (
                    <span className="text-xs text-[var(--fg-muted)]">{hinweis}</span>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${s.id}-community`}>Community ersetzen</Label>
                <Input
                  id={`${s.id}-community`}
                  type="password"
                  placeholder="unverändert"
                  autoComplete="off"
                  onBlur={(e) => {
                    const wert = e.target.value;
                    if (!wert) return;
                    e.target.value = "";
                    aendern.mutate({ id: s.id, felder: { community: wert } });
                    toast.success("Community ersetzt.");
                  }}
                />
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
