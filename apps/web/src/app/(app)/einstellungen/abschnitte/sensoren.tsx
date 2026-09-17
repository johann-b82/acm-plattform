"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlugZap, Plus } from "lucide-react";

import {
  einstellungenAusEntwurf,
  einstellungsFehler,
  sensorApi,
  sensorKeys,
  type EinstellungsEntwurf,
  type Sensor,
  type SensorEinstellungen,
} from "@/lib/sensoren";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Switch,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";
import type { Texte } from "@/texte";

/** Was sich an einem angelegten Gerät ändern lässt, in der Reihenfolge der Maske.
 *  Grenzwerte gehören nicht mehr dazu — sie gelten global (SET-11). */
const FELDER: {
  feld: keyof Sensor;
  wort: keyof Texte["sensorEinstellungen"];
  hinweis?: keyof Texte["sensorEinstellungen"];
  breit?: boolean;
}[] = [
  { feld: "name", wort: "name" },
  { feld: "rechner", wort: "rechner", hinweis: "rechnerHinweis" },
  { feld: "port", wort: "port" },
  { feld: "temperatur_oid", wort: "kennungTemperatur", breit: true },
  { feld: "feuchte_oid", wort: "kennungLuftfeuchte", breit: true },
  { feld: "temperatur_faktor", wort: "faktorTemperatur", hinweis: "faktorHinweis" },
  { feld: "feuchte_faktor", wort: "faktorLuftfeuchte" },
  { feld: "farbe", wort: "farbe", hinweis: "farbeHinweis" },
];

const ZAHLENFELDER = new Set<keyof Sensor>([
  "port",
  "temperatur_faktor",
  "feuchte_faktor",
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
  const worte = useTexte();
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
      toast.success(worte.sensorEinstellungen.sensorAngelegt);
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
              e.feuchte !== null ? `${e.feuchte} (Luftfeuchtigkeit)` : null,
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
      toast.success(worte.sensorEinstellungen.sensorGeloescht);
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
      <TaktUndGrenzen />

      <Card className="space-y-3 p-5">
        <h3 className="font-medium">{worte.sensorEinstellungen.neuesGeraet}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="neu-name">{worte.sensorEinstellungen.name}</Label>
            <Input
              id="neu-name"
              value={neu.name}
              placeholder={worte.sensorEinstellungen.nameBeispiel}
              onChange={(e) => setNeu({ ...neu, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="neu-rechner">{worte.sensorEinstellungen.rechner}</Label>
            <Input
              id="neu-rechner"
              value={neu.rechner}
              placeholder={worte.sensorEinstellungen.rechnerBeispiel}
              onChange={(e) => setNeu({ ...neu, rechner: e.target.value })}
            />
            <span className="text-xs text-[var(--fg-muted)]">
              muss in SNMP_ERLAUBT stehen
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="neu-community">{worte.sensorEinstellungen.community}</Label>
            <Input
              id="neu-community"
              type="password"
              value={neu.community}
              autoComplete="off"
              onChange={(e) => setNeu({ ...neu, community: e.target.value })}
            />
            <span className="text-xs text-[var(--fg-muted)]">
              {worte.einstellungenText.communityHinweis}
            </span>
          </div>
          <div className="flex flex-col gap-1 lg:col-span-2">
            <Label htmlFor="neu-temp">{worte.sensorEinstellungen.kennungTemperatur}</Label>
            <Input
              id="neu-temp"
              value={neu.temperatur_oid}
              placeholder="1.3.6.1.4.1.…"
              onChange={(e) => setNeu({ ...neu, temperatur_oid: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 lg:col-span-2">
            <Label htmlFor="neu-feuchte">{worte.sensorEinstellungen.kennungLuftfeuchte}</Label>
            <Input
              id="neu-feuchte"
              value={neu.feuchte_oid}
              placeholder={worte.sensorEinstellungen.optional}
              onChange={(e) => setNeu({ ...neu, feuchte_oid: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!bereit || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {worte.sensorEinstellungen.anlegen}
          </Button>
          <Button
            variant="outline"
            disabled={!bereit || ausprobieren.isPending}
            onClick={() => ausprobieren.mutate()}
          >
            <PlugZap className="me-1.5 h-4 w-4" aria-hidden />
            {ausprobieren.isPending ? worte.sensorEinstellungen.fragt : worte.sensorEinstellungen.ausprobieren}
          </Button>
          {probe && <span className="text-sm text-[var(--fg-muted)]">{probe}</span>}
        </div>
      </Card>

      {sensoren.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title={worte.sensorEinstellungen.keinGeraet}
          body={worte.sensorEinstellungen.keinGeraetText}
        />
      ) : (
        liste.map((s) => (
          <Card key={s.id} className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-medium">{s.name}</h3>
              <div className="ms-auto flex items-center gap-3">
                <Switch
                  checked={s.aktiv}
                  label={worte.sensorEinstellungen.wirdAbgefragt(s.name)}
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
              {FELDER.map(({ feld, wort, hinweis, breit }) => (
                <div
                  key={feld}
                  className={breit ? "flex flex-col gap-1 lg:col-span-2" : "flex flex-col gap-1"}
                >
                  <Label htmlFor={`${s.id}-${feld}`}>{worte.sensorEinstellungen[wort] as string}</Label>
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
                        toast.error(worte.sensorEinstellungen.zahlEingeben);
                        e.target.value = alt;
                        return;
                      }
                      aendern.mutate({ id: s.id, felder: { [feld]: wert } });
                    }}
                  />
                  {hinweis && (
                    <span className="text-xs text-[var(--fg-muted)]">
                      {worte.sensorEinstellungen[hinweis] as string}
                    </span>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${s.id}-community`}>{worte.sensorEinstellungen.communityErsetzen}</Label>
                <Input
                  id={`${s.id}-community`}
                  type="password"
                  placeholder={worte.sensorEinstellungen.unveraendert}
                  autoComplete="off"
                  onBlur={(e) => {
                    const wert = e.target.value;
                    if (!wert) return;
                    e.target.value = "";
                    aendern.mutate({ id: s.id, felder: { community: wert } });
                    toast.success(worte.sensorEinstellungen.communityErsetzt);
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

const GRENZFELDER: { feld: keyof SensorEinstellungen; wort: keyof Texte["sensorEinstellungen"] }[] = [
  { feld: "temperatur_min", wort: "temperaturMin" },
  { feld: "temperatur_max", wort: "temperaturMax" },
  { feld: "feuchte_min", wort: "feuchteMin" },
  { feld: "feuchte_max", wort: "feuchteMax" },
];

function alsEntwurf(e: SensorEinstellungen): EinstellungsEntwurf {
  const text = (w: number | null) => (w === null ? "" : String(w));
  return {
    abfrage_sekunden: String(e.abfrage_sekunden),
    temperatur_min: text(e.temperatur_min),
    temperatur_max: text(e.temperatur_max),
    feuchte_min: text(e.feuchte_min),
    feuchte_max: text(e.feuchte_max),
  };
}

/**
 * Takt und Grenzwerte für alle Geräte (SET-10, SET-11).
 *
 * Wie im Altsystem ein Entwurf mit „Speichern" und „Verwerfen": vier Grenzen
 * und ein Intervall gehören zusammen, und eine halb eingetippte Grenze soll
 * nicht schon gelten.
 */
function TaktUndGrenzen() {
  const worte = useTexte();
  const w = worte.sensorEinstellungen;
  const queryClient = useQueryClient();
  const einstellungen = useQuery({
    queryKey: sensorKeys.einstellungen(),
    queryFn: sensorApi.einstellungen,
  });
  const [entwurf, setEntwurf] = useState<EinstellungsEntwurf | null>(null);

  const speichern = useMutation({
    mutationFn: (e: EinstellungsEntwurf) => sensorApi.einstellungenSpeichern(einstellungenAusEntwurf(e)),
    onSuccess: () => {
      setEntwurf(null);
      toast.success(w.einstellungenGespeichert);
      return queryClient.invalidateQueries({ queryKey: sensorKeys.einstellungen() });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  if (einstellungen.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>;
  }
  if (!einstellungen.data) return null;

  const werte = entwurf ?? alsEntwurf(einstellungen.data);
  const fehler = einstellungsFehler(werte);
  const setze = (feld: keyof EinstellungsEntwurf, wert: string) => setEntwurf({ ...werte, [feld]: wert });

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-2">
        <h3 className="font-medium">{w.taktTitel}</h3>
        <div className="flex max-w-sm flex-col gap-1">
          <Label htmlFor="sensor-intervall">{w.intervall}</Label>
          <Input
            id="sensor-intervall"
            type="number"
            min={5}
            max={86400}
            step={1}
            value={werte.abfrage_sekunden}
            aria-invalid={fehler.includes("intervall")}
            onChange={(e) => setze("abfrage_sekunden", e.target.value)}
          />
          <span
            className={
              fehler.includes("intervall") ? "text-xs text-[var(--danger)]" : "text-xs text-[var(--fg-muted)]"
            }
          >
            {fehler.includes("intervall") ? w.intervallFehler : w.intervallHinweis}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">{w.grenzenTitel}</h3>
        <p className="text-xs text-[var(--fg-muted)]">{w.grenzenHinweis}</p>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          {GRENZFELDER.map(({ feld, wort }) => (
            <div key={feld} className="flex flex-col gap-1">
              <Label htmlFor={`sensor-${feld}`}>{w[wort] as string}</Label>
              <Input
                id={`sensor-${feld}`}
                inputMode="decimal"
                value={werte[feld]}
                onChange={(e) => setze(feld, e.target.value)}
              />
            </div>
          ))}
        </div>
        {fehler.includes("zahl") && <p className="text-xs text-[var(--danger)]">{w.zahlEingeben}</p>}
        {fehler.includes("temperatur") && <p className="text-xs text-[var(--danger)]">{w.temperaturFehler}</p>}
        {fehler.includes("feuchte") && <p className="text-xs text-[var(--danger)]">{w.feuchteFehler}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={entwurf === null || fehler.length > 0 || speichern.isPending}
          onClick={() => entwurf && speichern.mutate(entwurf)}
        >
          {worte.allgemein.speichern}
        </Button>
        <Button variant="outline" disabled={entwurf === null} onClick={() => setEntwurf(null)}>
          {w.verwerfen}
        </Button>
      </div>
    </Card>
  );
}
