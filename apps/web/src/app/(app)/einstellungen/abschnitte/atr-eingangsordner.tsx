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
import { Hinweis } from "@/components/ui/hinweis";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import type { Texte } from "@/texte";


const FELDER: {
  feld: keyof ScanEinstellung;
  wort: keyof Texte["atrEinstellungen"];
  hinweis?: keyof Texte["atrEinstellungen"];
}[] = [
  { feld: "rechner", wort: "rechner", hinweis: "rechnerHinweis" },
  { feld: "freigabe", wort: "freigabe" },
  { feld: "domaene", wort: "domaene" },
  { feld: "benutzer", wort: "benutzer" },
  { feld: "eingang", wort: "eingang" },
  { feld: "ausgang", wort: "ausgang" },
  { feld: "archiv", wort: "archiv" },
];

/**
 * Der Eingangsordner auf dem Dateiserver.
 *
 * Was hier steht, gilt für alle: ein Ordner, ein Dienstkonto, ein Takt. Das
 * Ziel setzt deshalb die Plattform-Verwaltung — die Datenbank hält dieselbe
 * Grenze, unabhängig von dieser Maske. Den Eingang von Hand durchsehen darf
 * dagegen, wer ATR bearbeitet; dieser Knopf sitzt bei den Lieferungen.
 *
 * Das Passwort steht nicht hier, sondern als `ATR_SMB_PASSWORT` in der
 * Umgebung von `compute`: ein Geheimnis in der Datenbank bräuchte zusätzlich
 * einen Schlüssel, und der Geheimtext läge in jeder Sicherung. Und welche
 * Rechner überhaupt in Frage kommen, gibt `ATR_SMB_ERLAUBT` vor — sonst wäre
 * diese Maske ein Weg, den Dienst gegen ein beliebiges Ziel im Netz laufen zu
 * lassen.
 */
export function Eingangsordner() {
  const worte = useTexte();
  const ZEIT = new Intl.DateTimeFormat(SPRACHE_TAG[useSprache()], {
    dateStyle: "short",
    timeStyle: "short",
  });
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
          ? worte.atrEinstellungen.verbindungSteht(e.dateien ?? 0)
          : worte.atrEinstellungen.keineVerbindung(
              e.meldung ?? worte.atrEinstellungen.unbekannt,
            ),
      ),
    onError: (fehler: Error) => setProbe(`Keine Verbindung: ${fehler.message}`),
  });

  const lauf = useMutation({
    mutationFn: scanApi.lauf,
    onSuccess: (e) => {
      setProbe(null);
      toast.success(worte.atrEinstellungen.gelesenAngelegt(e.gelesen, e.angelegt));
      for (const hinweis of e.hinweise) toast.error(hinweis);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  if (!s) return null;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-1.5 font-medium">
          {worte.atrEinstellungen.eingangsordner}
          <Hinweis
            text={
              worte.atrEinstellungen.eingangHinweis
            }
          />
        </h3>
        {s.aktiv ? (
          <Badge>{worte.atrEinstellungen.laeuft}</Badge>
        ) : (
          <Badge variant="outline">{worte.atrEinstellungen.aus}</Badge>
        )}
        <span className="text-sm text-[var(--fg-muted)]">
          {s.zuletzt_am
            ? worte.atrEinstellungen.zuletzt(
                ZEIT.format(new Date(s.zuletzt_am)),
                s.zuletzt_text ?? "—",
              )
            : worte.atrEinstellungen.nochNichtGelaufen}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            onClick={() => pruefen.mutate()}
            disabled={pruefen.isPending}
          >
            <PlugZap className="mr-1.5 h-4 w-4" aria-hidden />
            {pruefen.isPending ? worte.atrEinstellungen.prueft : worte.atrEinstellungen.verbindungPruefen}
          </Button>
          <Button onClick={() => lauf.mutate()} disabled={lauf.isPending}>
            <FolderSearch className="mr-1.5 h-4 w-4" aria-hidden />
            {lauf.isPending ? worte.atrEinstellungen.laeuftGerade : worte.atrEinstellungen.jetztDurchsehen}
          </Button>
        </div>
      </div>

      {probe && <p className="text-sm text-[var(--fg-muted)]">{probe}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FELDER.map(({ feld, wort, hinweis }) => (
          <div key={feld} className="flex flex-col gap-1">
            <Label htmlFor={feld}>{worte.atrEinstellungen[wort] as string}</Label>
            <Input
              id={feld}
              defaultValue={(s[feld] as string | null) ?? ""}
              placeholder="—"
              onBlur={(e) => {
                const wert = e.target.value.trim() || null;
                if (wert !== ((s[feld] as string | null) ?? null)) {
                  aendern.mutate({ [feld]: wert } as Partial<ScanEinstellung>);
                }
              }}
            />
            {hinweis && (
              <span className="text-xs text-[var(--fg-muted)]">
                {worte.atrEinstellungen[hinweis] as string}
              </span>
            )}
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="modus">{worte.atrEinstellungen.wasEinLaufTut}</Label>
          <Select
            id="modus"
            value={s.modus}
            onChange={(e) =>
              aendern.mutate({ modus: e.target.value as ScanEinstellung["modus"] })
            }
          >
            <option value="entwurf">{worte.atrEinstellungen.entwurfAnlegen}</option>
            <option value="automatisch">{worte.atrEinstellungen.dokumenteErzeugen}</option>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={s.aktiv}
          onCheckedChange={(an) => aendern.mutate({ aktiv: an })}
          label={worte.atrEinstellungen.regelmaessig}
        />
        <span className="text-sm">
          {worte.atrEinstellungen.regelmaessigHinweis}
        </span>
      </div>
    </Card>
  );
}
