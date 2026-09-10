"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderSearch, PlugZap } from "lucide-react";

import { scanApi, scanKeys, type ScanEinstellung } from "@/lib/atr";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  Switch,
} from "@/components/ui/primitives";

const ZEIT = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});

const FELDER: { feld: keyof ScanEinstellung; label: string; hinweis?: string }[] = [
  { feld: "rechner", label: "Rechner", hinweis: "muss in ATR_SMB_ERLAUBT stehen" },
  { feld: "freigabe", label: "Freigabe" },
  { feld: "domaene", label: "Domäne" },
  { feld: "benutzer", label: "Benutzer" },
  { feld: "eingang", label: "Eingang" },
  { feld: "ausgang", label: "Ausgang" },
  { feld: "archiv", label: "Archiv" },
];

/**
 * Der Eingangsordner auf dem Dateiserver.
 *
 * Zwei Rechtestufen liegen hier übereinander, und die Datenbank hält beide:
 * durchsehen darf, wer ATR bearbeitet; das Ziel eintragen nur die
 * Plattform-Verwaltung. Deshalb sind die Felder für alle anderen nur zu
 * lesen — sie sollen sehen, worauf der Lauf zeigt.
 *
 * Das Passwort steht nicht hier, sondern als `ATR_SMB_PASSWORT` in der
 * Umgebung von `compute`: ein Geheimnis in der Datenbank bräuchte zusätzlich
 * einen Schlüssel, und der Geheimtext läge in jeder Sicherung. Und welche
 * Rechner überhaupt in Frage kommen, gibt `ATR_SMB_ERLAUBT` vor — sonst wäre
 * diese Maske ein Weg, den Dienst gegen ein beliebiges Ziel im Netz laufen zu
 * lassen.
 */
export function Eingangsordner({
  darfSchreiben,
  darfEinrichten,
}: {
  darfSchreiben: boolean;
  darfEinrichten: boolean;
}) {
  const queryClient = useQueryClient();
  const [probe, setProbe] = useState<string | null>(null);

  const einstellung = useQuery({
    queryKey: scanKeys.einstellung(),
    queryFn: scanApi.einstellung,
  });
  const s = einstellung.data;

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

  const aendern = useMutation({
    mutationFn: (felder: Partial<ScanEinstellung>) => scanApi.aendern(felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const pruefen = useMutation({
    mutationFn: scanApi.probe,
    onSuccess: (e) =>
      setProbe(
        e.erreichbar
          ? `Verbindung steht. ${e.dateien ?? 0} ${
              e.dateien === 1 ? "Datei wartet" : "Dateien warten"
            } im Eingang.`
          : `Keine Verbindung: ${e.meldung ?? "unbekannt"}`,
      ),
    onError: (fehler: Error) => setProbe(`Keine Verbindung: ${fehler.message}`),
  });

  const lauf = useMutation({
    mutationFn: scanApi.lauf,
    onSuccess: (e) => {
      setProbe(null);
      toast.success(`${e.gelesen} gelesen, ${e.angelegt} angelegt.`);
      for (const hinweis of e.hinweise) toast.error(hinweis);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  if (!s) return null;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium">Eingangsordner</h3>
        {s.aktiv ? <Badge>läuft</Badge> : <Badge variant="outline">aus</Badge>}
        <span className="text-sm text-[var(--fg-muted)]">
          {s.zuletzt_am
            ? `Zuletzt ${ZEIT.format(new Date(s.zuletzt_am))}: ${s.zuletzt_text ?? "—"}`
            : "Noch nicht gelaufen."}
        </span>
        {darfSchreiben && (
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              onClick={() => pruefen.mutate()}
              disabled={pruefen.isPending}
            >
              <PlugZap className="mr-1.5 h-4 w-4" aria-hidden />
              {pruefen.isPending ? "Prüfe …" : "Verbindung prüfen"}
            </Button>
            <Button onClick={() => lauf.mutate()} disabled={lauf.isPending}>
              <FolderSearch className="mr-1.5 h-4 w-4" aria-hidden />
              {lauf.isPending ? "Läuft …" : "Jetzt durchsehen"}
            </Button>
          </div>
        )}
      </div>

      {probe && <p className="text-sm text-[var(--fg-muted)]">{probe}</p>}

      <p className="max-w-prose text-sm text-[var(--fg-muted)]">
        Ein Lieferschein im Eingang wird eingelesen, wird zur Lieferung und
        wandert ins Archiv. Das Passwort des Dienstkontos steht nicht hier,
        sondern als <code>ATR_SMB_PASSWORT</code> in der Umgebung; welche
        Rechner in Frage kommen, gibt <code>ATR_SMB_ERLAUBT</code> vor.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FELDER.map(({ feld, label, hinweis }) => (
          <div key={feld} className="flex flex-col gap-1">
            <Label htmlFor={feld}>{label}</Label>
            <Input
              id={feld}
              defaultValue={(s[feld] as string | null) ?? ""}
              placeholder="—"
              disabled={!darfEinrichten}
              onBlur={(e) => {
                const wert = e.target.value.trim() || null;
                if (wert !== ((s[feld] as string | null) ?? null)) {
                  aendern.mutate({ [feld]: wert } as Partial<ScanEinstellung>);
                }
              }}
            />
            {hinweis && darfEinrichten && (
              <span className="text-xs text-[var(--fg-muted)]">{hinweis}</span>
            )}
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="modus">Was ein Lauf tut</Label>
          <Select
            id="modus"
            value={s.modus}
            disabled={!darfEinrichten}
            onChange={(e) =>
              aendern.mutate({ modus: e.target.value as ScanEinstellung["modus"] })
            }
          >
            <option value="entwurf">Entwurf zur Durchsicht anlegen</option>
            <option value="automatisch">Dokumente erzeugen und ablegen</option>
          </Select>
        </div>
      </div>

      {darfEinrichten && (
        <div className="flex items-center gap-2">
          <Switch
            checked={s.aktiv}
            onCheckedChange={(an) => aendern.mutate({ aktiv: an })}
            label="Regelmäßig durchsehen"
          />
          <span className="text-sm">
            Regelmäßig durchsehen — alle zehn Minuten, werktags 5–19 Uhr
          </span>
        </div>
      )}
    </Card>
  );
}
