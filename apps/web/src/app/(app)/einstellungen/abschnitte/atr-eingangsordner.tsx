"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderSearch, PlugZap } from "lucide-react";

import {
  intervallAusEingabe,
  scanApi,
  scanKeys,
  type PasswortStand,
  type ScanEinstellung,
} from "@/lib/atr";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui/primitives";
import { Hinweis } from "@/components/ui/hinweis";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import type { Texte } from "@/texte";

const FELDER: {
  feld: "rechner" | "freigabe" | "domaene" | "benutzer" | "eingang" | "ausgang" | "archiv";
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

/** Wohin „Auf Server speichern“ ablegt. Die Mappe je Programm, die beiden
 *  PDF-Ziele für beide. Vorbelegt mit den Pfaden des Altprojekts. */
const ZIELE: {
  feld: "ziel_mappe_a350" | "ziel_mappe_a380" | "ziel_logistik" | "ziel_weight_report";
  wort: keyof Texte["atrEinstellungen"];
}[] = [
  { feld: "ziel_mappe_a350", wort: "zielMappeA350" },
  { feld: "ziel_mappe_a380", wort: "zielMappeA380" },
  { feld: "ziel_logistik", wort: "zielLogistik" },
  { feld: "ziel_weight_report", wort: "zielWeightReport" },
];

/**
 * Der Eingangsordner auf dem Dateiserver.
 *
 * Was hier steht, gilt für alle: ein Ordner, ein Dienstkonto, ein Takt. Das
 * Ziel setzt deshalb die Plattform-Verwaltung — die Datenbank hält dieselbe
 * Grenze, unabhängig von dieser Maske. Den Eingang von Hand durchsehen darf
 * dagegen, wer ATR bearbeitet; dieser Knopf sitzt bei den Lieferungen.
 *
 * Wie im Altsystem eine Maske mit „Speichern“ (SET-13/14): das Intervall in
 * Sekunden, 0 = aus, und das Passwort des Dienstkontos. Das Passwort geht
 * verschlüsselt an `compute` und kommt nie zurück; die Maske erfährt nur, ob
 * eines hinterlegt ist. Leer lassen behält es. Welche Rechner überhaupt in
 * Frage kommen, gibt weiter `ATR_SMB_ERLAUBT` vor.
 */
export function Eingangsordner() {
  const worte = useTexte();
  const ZEIT = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], {
    dateStyle: "short",
    timeStyle: "short",
  });
  const queryClient = useQueryClient();
  const [probe, setProbe] = useState<string | null>(null);

  const einstellung = useQuery({
    queryKey: scanKeys.einstellung(),
    queryFn: scanApi.einstellung,
  });
  const passwort = useQuery({
    queryKey: scanKeys.passwort(),
    queryFn: scanApi.passwortStand,
  });
  const s = einstellung.data;

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
      return queryClient.invalidateQueries({ queryKey: ["atr"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  if (!s) return null;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-1.5 font-medium">
          {worte.atrEinstellungen.eingangsordner}
          <Hinweis text={worte.atrEinstellungen.eingangHinweis} />
        </h3>
        {s.intervall_s > 0 ? (
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
        <div className="ms-auto flex gap-2">
          <Button
            variant="outline"
            onClick={() => pruefen.mutate()}
            disabled={pruefen.isPending}
          >
            <PlugZap className="me-1.5 h-4 w-4" aria-hidden />
            {pruefen.isPending ? worte.atrEinstellungen.prueft : worte.atrEinstellungen.verbindungPruefen}
          </Button>
          <Button onClick={() => lauf.mutate()} disabled={lauf.isPending}>
            <FolderSearch className="me-1.5 h-4 w-4" aria-hidden />
            {lauf.isPending ? worte.atrEinstellungen.laeuftGerade : worte.atrEinstellungen.jetztDurchsehen}
          </Button>
        </div>
      </div>

      {probe && <p className="text-sm text-[var(--fg-muted)]">{probe}</p>}

      {/* Neu aufgesetzt, sobald sich die gespeicherte Einstellung ändert —
          nicht bei jedem Lauf, der nur „zuletzt“ fortschreibt. */}
      <Formular
        key={[
          s.intervall_s,
          s.modus,
          ...FELDER.map(({ feld }) => s[feld]),
          ...ZIELE.map(({ feld }) => s[feld]),
        ].join("|")}
        einstellung={s}
        passwort={passwort.data}
      />
    </Card>
  );
}

function Formular({
  einstellung: s,
  passwort,
}: {
  einstellung: ScanEinstellung;
  passwort: PasswortStand | undefined;
}) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const anfang: Record<string, string> = Object.fromEntries(
    FELDER.map(({ feld }) => [feld, s[feld] ?? ""]),
  );
  const [entwurf, setEntwurf] = useState(anfang);
  const zielAnfang: Record<string, string> = Object.fromEntries(
    ZIELE.map(({ feld }) => [feld, s[feld]]),
  );
  const [ziele, setZiele] = useState(zielAnfang);
  const [intervall, setIntervall] = useState(String(s.intervall_s));
  const [modus, setModus] = useState(s.modus);
  const [kennwort, setKennwort] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  const speichern = useMutation({
    mutationFn: async () => {
      const sekunden = intervallAusEingabe(intervall);
      if (sekunden === null) throw new Error(worte.atrEinstellungen.intervallUngueltig);
      const felder: Partial<ScanEinstellung> = {};
      for (const { feld } of FELDER) {
        if (entwurf[feld].trim() !== anfang[feld]) felder[feld] = entwurf[feld].trim() || null;
      }
      // Ein Ziel wird nie geleert: leer schriebe in die Wurzel der Freigabe,
      // und die Datenbank weist es ab.
      for (const { feld } of ZIELE) {
        if (ziele[feld].trim() !== zielAnfang[feld]) felder[feld] = ziele[feld].trim();
      }
      if (sekunden !== s.intervall_s) felder.intervall_s = sekunden;
      if (modus !== s.modus) felder.modus = modus;
      if (Object.keys(felder).length > 0) await scanApi.aendern(felder);
      // Leer heißt: das hinterlegte Passwort bleibt.
      if (kennwort) await scanApi.passwortSetzen(kennwort);
    },
    onSuccess: () => {
      setKennwort("");
      setFehler(null);
      toast.success(worte.atrEinstellungen.gespeichert);
      return queryClient.invalidateQueries({ queryKey: ["atr"] });
    },
    // Die Prüfung der Zielordner sitzt in der Datenbank; ihre Meldung nennt
    // nur den Namen der Bedingung.
    onError: (f: Error) =>
      setFehler(/_gueltig/.test(f.message) ? worte.atrEinstellungen.zielUngueltig : f.message),
  });

  const passwortText = !passwort
    ? undefined
    : passwort.quelle === "datenbank"
      ? worte.atrEinstellungen.passwortHinterlegt
      : passwort.quelle === "umgebung"
        ? worte.atrEinstellungen.passwortUmgebung
        : worte.atrEinstellungen.passwortFehlt;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        speichern.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FELDER.map(({ feld, wort, hinweis }) => (
          <div key={feld} className="flex flex-col gap-1">
            <Label htmlFor={feld}>{worte.atrEinstellungen[wort] as string}</Label>
            <Input
              id={feld}
              value={entwurf[feld]}
              placeholder="—"
              onChange={(e) => setEntwurf((alt) => ({ ...alt, [feld]: e.target.value }))}
            />
            {hinweis && (
              <span className="text-xs text-[var(--fg-muted)]">
                {worte.atrEinstellungen[hinweis] as string}
              </span>
            )}
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="passwort">{worte.atrEinstellungen.passwort}</Label>
          <Input
            id="passwort"
            type="password"
            autoComplete="new-password"
            value={kennwort}
            placeholder={passwortText}
            onChange={(e) => setKennwort(e.target.value)}
          />
          {passwortText && <span className="text-xs text-[var(--fg-muted)]">{passwortText}</span>}
          {passwort && !passwort.schluessel_bereit && (
            <span className="text-xs text-[var(--danger)]">
              {worte.atrEinstellungen.passwortOhneSchluessel}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="intervall">{worte.atrEinstellungen.intervall}</Label>
          <Input
            id="intervall"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={intervall}
            onChange={(e) => setIntervall(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="modus">{worte.atrEinstellungen.wasEinLaufTut}</Label>
          <Select
            id="modus"
            value={modus}
            onChange={(e) => setModus(e.target.value as ScanEinstellung["modus"])}
          >
            <option value="entwurf">{worte.atrEinstellungen.entwurfAnlegen}</option>
            <option value="automatisch">{worte.atrEinstellungen.dokumenteErzeugen}</option>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          {worte.atrEinstellungen.ablageziele}
          <Hinweis text={worte.atrEinstellungen.ablagezieleHinweis} />
        </legend>
        <div className="grid gap-3 lg:grid-cols-2">
          {ZIELE.map(({ feld, wort }) => (
            <div key={feld} className="flex flex-col gap-1">
              <Label htmlFor={feld}>{worte.atrEinstellungen[wort] as string}</Label>
              <Input
                id={feld}
                dir="ltr"
                className="font-mono text-xs"
                value={ziele[feld]}
                onChange={(e) => setZiele((alt) => ({ ...alt, [feld]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {fehler && (
          <p role="alert" className="me-auto text-sm text-[var(--danger)]">
            {fehler}
          </p>
        )}
        <Button type="submit" disabled={speichern.isPending}>
          {worte.atrEinstellungen.speichern}
        </Button>
      </div>
    </form>
  );
}
