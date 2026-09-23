"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Eye, FileDown, FileUp, ScanLine, X } from "lucide-react";

import {
  WEG,
  dokumentApi,
  dokumentKeys,
  naechste,
  type Feld,
  type FeldStatus,
  type Stand,
  type Vorgang,
} from "@/lib/dokumente";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Dialog } from "@/components/ui/dialog";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { useDokumentworte } from "@/lib/tafeln";
import { Segmentwahl } from "../segmentwahl";

/**
 * Einarbeitungs- und Schulungsvorgänge — der frühere Dokumentenlauf, jetzt
 * unter der Einarbeitungsmatrix wie im Altsystem (DOK-02).
 *
 * Ein Blatt wird erzeugt, ausgehändigt, ausgefüllt zurückgegeben und geprüft.
 * Der QR-Code darauf ordnet den Scan wieder zu — unabhängig von Dateiname und
 * Schreibweise. Die Spalten folgen der Referenz: je Station ihr Datum.
 *
 * Die Prüfung sieht, **ob** in einem Feld etwas steht, nicht was. Deshalb
 * steht das Urteil daneben zum Überstimmen: wer das Blatt in der Hand hatte,
 * weiß es besser.
 */
export function Vorgaenge({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const dokumentworte = useDokumentworte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "short" });
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Stand | "alle">("alle");
  const [offen, setOffen] = useState<string | null>(null);
  //: Der Vorgang, dessen Scan-Auswertung gerade als Dialog offen ist.
  const [pruef, setPruef] = useState<Vorgang | null>(null);

  const vorgaenge = useQuery({ queryKey: dokumentKeys.liste(), queryFn: dokumentApi.liste });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["dokumente"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const weiter = useMutation({
    mutationFn: ({ id, ziel }: { id: string; ziel: Stand }) => dokumentApi.weiter(id, ziel),
    onSuccess: neuLaden,
    onError: melde,
  });

  const scan = useMutation({
    mutationFn: ({ id, datei }: { id: string; datei: File }) => dokumentApi.scan(id, datei),
    // Nach dem Einlesen die Auswertung als Dialog öffnen: erkannt / fehlt /
    // nicht erkannt, mit den Knöpfen zum Bestätigen bzw. Abschließen.
    onSuccess: (v) => {
      setPruef(v);
      return neuLaden();
    },
    onError: melde,
  });

  const urteilen = useMutation({
    mutationFn: ({ id, wert }: { id: string; wert: boolean }) => dokumentApi.urteil(id, wert, null),
    onSuccess: neuLaden,
    onError: melde,
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => dokumentApi.loeschen(id),
    onSuccess: () => {
      setPruef(null);
      return neuLaden();
    },
    onError: melde,
  });

  const feld = useMutation({
    mutationFn: (e: { id: string; key: string; status: FeldStatus; kommentar?: string | null }) =>
      dokumentApi.feld(e.id, { key: e.key, status: e.status, kommentar: e.kommentar }),
    // Das neu gerechnete Prüfergebnis in den offenen Dialog übernehmen. Die
    // compute-Antwort trägt kein `scan_pfad`; deshalb über den bisherigen Stand
    // legen, damit der „Scan ansehen"-Knopf nicht verschwindet.
    onSuccess: (v) => {
      setPruef((vorher) => (vorher ? { ...vorher, ...v } : v));
      return neuLaden();
    },
    onError: melde,
  });

  const oeffnen = useMutation({
    mutationFn: ({ id, was }: { id: string; was: "blatt.pdf" | "scan" }) => dokumentApi.oeffnen(id, was),
    onError: melde,
  });

  const vorgangsDaten = vorgaenge.data;
  const liste = useMemo(
    () => (vorgangsDaten ?? []).filter((v) => filter === "alle" || v.status === filter),
    [vorgangsDaten, filter],
  );

  const datum = (wert: string | null) => (wert ? DATUM.format(new Date(wert)) : "—");
  const stempelSpalte = (
    schluessel: "erstellt_am" | "uebergeben_am" | "zurueck_am" | "geprueft_am",
    titel: string,
  ): Tabellenspalte<Vorgang> => ({
    schluessel,
    titel,
    typ: "datum",
    suchtext: false,
    wert: (v) => v[schluessel],
    zelle: (v) => datum(v[schluessel]),
  });

  const spalten: Tabellenspalte<Vorgang>[] = [
    {
      schluessel: "art",
      titel: worte.dokumentenlauf.formblatt,
      typ: "text",
      wert: (v) => dokumentworte.art[v.art],
      zelle: (v) => <Badge variant="outline">{dokumentworte.art[v.art]}</Badge>,
    },
    {
      schluessel: "name",
      titel: worte.dokumentenlauf.person,
      typ: "text",
      wert: (v) => v.name,
      suchtext: (v) => `${v.name} ${v.funktion ?? ""}`,
      zelle: (v) => (
        <>
          <span className="font-medium">{v.name}</span>
          {v.funktion && <span className="block text-xs text-[var(--fg-muted)]">{v.funktion}</span>}
        </>
      ),
    },
    {
      schluessel: "kennung",
      titel: worte.dokumentenlauf.kennung,
      typ: "text",
      wert: (v) => v.doc_uid,
      className: "font-mono text-xs",
    },
    {
      schluessel: "stand",
      titel: worte.dokumentenlauf.stand,
      typ: "zahl",
      wert: (v) => WEG.indexOf(v.status),
      suchtext: (v) => dokumentworte.stand[v.status],
      zelle: (v) => (
        <Badge variant={v.status === "geprueft" ? "default" : "outline"}>
          {dokumentworte.stand[v.status]}
        </Badge>
      ),
    },
    stempelSpalte("erstellt_am", worte.dokumentenlauf.erstelltAm),
    stempelSpalte("uebergeben_am", worte.dokumentenlauf.uebergebenAm),
    stempelSpalte("zurueck_am", worte.dokumentenlauf.zurueckAm),
    stempelSpalte("geprueft_am", worte.dokumentenlauf.geprueftAm),
    {
      schluessel: "vollstaendig",
      titel: worte.dokumentenlauf.vollstaendigSpalte,
      typ: "zahl",
      suchtext: false,
      wert: (v) => (v.vollstaendig === null ? null : Number(v.vollstaendig)),
      zelle: (v) => (
        <Urteil
          vorgang={v}
          darfSchreiben={darfSchreiben}
          laeuft={urteilen.isPending}
          umkehren={(wert) => urteilen.mutate({ id: v.id, wert })}
        />
      ),
    },
    {
      schluessel: "aktionen",
      titel: worte.dokumentenlauf.aktionen,
      typ: "text",
      sortierbar: false,
      suchtext: false,
      wert: () => null,
      ausrichtung: "end",
      zelle: (v) => {
        const ziel = naechste(v.status);
        return (
          // Bis zu fünf Bedienelemente nebeneinander, mehrere davon randlos:
          // mit gap-2 standen sie zu eng, um sie auseinanderzuhalten.
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-2">
            <Button size="sm" variant="outline" onClick={() => oeffnen.mutate({ id: v.id, was: "blatt.pdf" })}>
              <FileDown className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {worte.dokumentenlauf.blatt}
            </Button>
            {v.scan_pfad && (
              <Button size="sm" variant="ghost" onClick={() => oeffnen.mutate({ id: v.id, was: "scan" })}>
                {worte.dokumentenlauf.scan}
              </Button>
            )}
            {/* Zurück und geprüft setzt der Scan selbst; von Hand geht es
                bis „zurück“ und von dort nur mit Scan weiter. */}
            {darfSchreiben && ziel && v.status !== "zurueck" && (
              <Button
                size="sm"
                variant="outline"
                disabled={weiter.isPending}
                onClick={() => weiter.mutate({ id: v.id, ziel })}
              >
                {dokumentworte.stand[ziel]}
              </Button>
            )}
            {darfSchreiben && (
              <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--muted)] focus-within:outline-2 focus-within:outline-[var(--ring)]">
                <ScanLine className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {scan.isPending ? worte.dokumentenlauf.prueft : worte.dokumentenlauf.scan}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="sr-only"
                  aria-label={worte.dokumentenlauf.scanFuer(v.name)}
                  disabled={scan.isPending}
                  onChange={(e) => {
                    const datei = e.target.files?.[0];
                    e.target.value = "";
                    if (datei) scan.mutate({ id: v.id, datei });
                  }}
                />
              </label>
            )}
            {v.pruef_ergebnis && (
              <Button size="sm" variant="ghost" onClick={() => setPruef(v)}>
                <Check className="me-1.5 h-3.5 w-3.5" aria-hidden />
                Prüfung
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={offen === v.id}
              onClick={() => setOffen(offen === v.id ? null : v.id)}
            >
              {offen === v.id ? worte.dokumentenlauf.zu : worte.dokumentenlauf.details}
            </Button>
            {darfSchreiben && (
              <ConfirmDeleteButton
                itemLabel={`${v.name} (${v.doc_uid})`}
                onConfirm={() => loeschen.mutateAsync(v.id).then(() => undefined)}
              />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {vorgaenge.error && <p className="text-sm text-[var(--danger)]">{(vorgaenge.error as Error).message}</p>}

      <Datentabelle
        zeilen={liste}
        spalten={spalten}
        zeilenSchluessel={(v) => v.id}
        laedt={vorgaenge.isPending}
        leer={worte.dokumentenlauf.keinVorgangText}
        beschriftung={worte.onboarding.vorgaengeTitel}
        zeilenKlasse={() => "align-top"}
        werkzeuge={
          <Segmentwahl
            wert={filter}
            beschriftung={worte.dokumentenlauf.stand}
            onChange={setFilter}
            optionen={[
              { wert: "alle" as const, titel: worte.dokumentenlauf.alle, anzahl: vorgangsDaten?.length },
              ...WEG.map((s) => ({
                wert: s,
                titel: dokumentworte.stand[s],
                anzahl: (vorgangsDaten ?? []).filter((v) => v.status === s).length,
              })),
            ]}
          />
        }
        unterZeile={(v) => (offen === v.id ? <Details vorgang={v} darfSchreiben={darfSchreiben} /> : null)}
      />

      {pruef && (
        <PruefDialog
          vorgang={pruef}
          darfSchreiben={darfSchreiben}
          laeuft={feld.isPending}
          onSchliessen={() => setPruef(null)}
          onScanAnsehen={() => oeffnen.mutate({ id: pruef.id, was: "scan" })}
          onFeld={(key, status, kommentar) => feld.mutate({ id: pruef.id, key, status, kommentar })}
        />
      )}
    </div>
  );
}

/** Die Zeitstempel je Station — ohne Namensbastelei im Markup. */
const STEMPEL: Record<Stand, keyof Vorgang> = {
  erstellt: "erstellt_am",
  uebergeben: "uebergeben_am",
  zurueck: "zurueck_am",
  geprueft: "geprueft_am",
};

/**
 * Das Urteil — mit dem Knopf, es umzukehren.
 *
 * Die Messung sieht, ob Tinte im Feld ist, nicht was dort steht. Wer das Blatt
 * in der Hand hatte, weiß es besser.
 */
function Urteil({
  vorgang,
  darfSchreiben,
  umkehren,
  laeuft,
}: {
  vorgang: Vorgang;
  darfSchreiben: boolean;
  umkehren: (wert: boolean) => void;
  laeuft: boolean;
}) {
  const worte = useTexte();
  if (vorgang.vollstaendig === null) {
    return <span className="text-sm text-[var(--fg-muted)]">{worte.dokumentenlauf.nochNichtGeprueft}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <Badge className={vorgang.vollstaendig ? "status-ok" : "status-bad"}>
        {vorgang.vollstaendig ? worte.dokumentenlauf.vollstaendig : worte.dokumentenlauf.unvollstaendig}
      </Badge>
      {darfSchreiben && (
        <Button
          size="sm"
          variant="ghost"
          title={worte.dokumentenlauf.umkehren}
          aria-label={worte.dokumentenlauf.umkehren}
          disabled={laeuft}
          onClick={() => umkehren(!vorgang.vollstaendig)}
        >
          {vorgang.vollstaendig ? <X className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
        </Button>
      )}
    </div>
  );
}

/**
 * Laufweg, Prüfergebnis je Feld und die angehängten Nachweise.
 *
 * Eigene Komponente und nicht im Elternteil verschachtelt: sonst entstünde sie
 * bei jedem Rendern neu, und ihr Zustand — der Zeilenbezug im Eingabefeld —
 * wäre jedes Mal weg.
 */
function Details({ vorgang, darfSchreiben }: { vorgang: Vorgang; darfSchreiben: boolean }) {
  const worte = useTexte();
  const dokumentworte = useDokumentworte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "short" });
  const queryClient = useQueryClient();
  const [zeile, setZeile] = useState("");

  const nachweise = useQuery({
    queryKey: dokumentKeys.nachweise(vorgang.id),
    queryFn: () => dokumentApi.nachweise(vorgang.id),
  });
  const hochladen = useMutation({
    mutationFn: (datei: File) => dokumentApi.nachweisHoch(vorgang.id, datei, zeile || undefined),
    onSuccess: () => {
      setZeile("");
      toast.success("Nachweis hinterlegt.");
      return queryClient.invalidateQueries({ queryKey: dokumentKeys.nachweise(vorgang.id) });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });
  const nachweisWeg = useMutation({
    mutationFn: (id: string) => dokumentApi.nachweisLoeschen(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dokumentKeys.nachweise(vorgang.id) }),
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <div className="space-y-3 text-start">
      <div className="flex flex-wrap gap-4 text-xs text-[var(--fg-muted)]">
        {WEG.map((s) => {
          const wann = vorgang[STEMPEL[s]];
          return (
            <span key={s}>
              {dokumentworte.stand[s]}: {typeof wann === "string" ? DATUM.format(new Date(wann)) : "—"}
            </span>
          );
        })}
      </div>

      {vorgang.pruef_ergebnis && (
        <div>
          <p className="text-sm font-medium">
            {worte.dokumentenlauf.pruefung}{" "}
            <span className="font-normal text-[var(--fg-muted)]">
              {vorgang.pruef_ergebnis.qr_ok ? worte.dokumentenlauf.qrGelesen : worte.dokumentenlauf.keinQr}
            </span>
          </p>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2">
            {vorgang.pruef_ergebnis.felder.map((f) => (
              <li key={f.key} className="flex items-center gap-2 text-xs">
                {f.erkannt ? (
                  <Check className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden />
                ) : (
                  <X className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
                )}
                <span className={f.erkannt ? "" : "text-[var(--fg-muted)]"}>{f.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-sm font-medium">{worte.dokumentenlauf.nachweise}</p>
        <ul className="mt-1 space-y-1 text-xs">
          {(nachweise.data ?? []).map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                onClick={() =>
                  dokumentApi.nachweisOeffnen(n.id).catch((fehler: Error) => toast.error(fehler.message))
                }
              >
                <Eye className="h-3.5 w-3.5" aria-hidden />
                {n.dateiname}
              </button>
              <span className="text-[var(--fg-muted)]">
                {n.zeile ? `· ${n.zeile} ` : ""}· {DATUM.format(new Date(n.hochgeladen_am))}
              </span>
              {darfSchreiben && (
                <ConfirmDeleteButton
                  itemLabel={n.dateiname}
                  onConfirm={() => nachweisWeg.mutateAsync(n.id).then(() => undefined)}
                />
              )}
            </li>
          ))}
          {nachweise.data?.length === 0 && (
            <li className="text-xs text-[var(--fg-muted)]">{worte.dokumentenlauf.keineNachweise}</li>
          )}
        </ul>
        {darfSchreiben && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={zeile}
              placeholder={worte.dokumentenlauf.welcheZeile}
              aria-label={worte.dokumentenlauf.welcheZeile}
              className="w-64 text-xs"
              onChange={(e) => setZeile(e.target.value)}
            />
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--muted)] focus-within:outline-2 focus-within:outline-[var(--ring)]">
              <FileUp className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {hochladen.isPending ? worte.dokumentenlauf.laedt : worte.dokumentenlauf.nachweis}
              <input
                type="file"
                className="sr-only"
                aria-label={worte.dokumentenlauf.nachweisHoch}
                disabled={hochladen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) hochladen.mutate(datei);
                }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Die Scan-Auswertung als Dialog: welche Prüfpunkte i.O. sind, welche fehlen und
 * welche die Automatik nicht erkannt hat. Nicht erkannte Punkte lassen sich von
 * Hand bestätigen oder mit einem Grund als nicht erforderlich abschließen —
 * beides zählt danach als erledigt.
 */
function PruefDialog({
  vorgang,
  darfSchreiben,
  laeuft,
  onSchliessen,
  onScanAnsehen,
  onFeld,
}: {
  vorgang: Vorgang;
  darfSchreiben: boolean;
  laeuft: boolean;
  onSchliessen: () => void;
  onScanAnsehen: () => void;
  onFeld: (key: string, status: FeldStatus, kommentar?: string | null) => void;
}) {
  const erg = vorgang.pruef_ergebnis;
  const felder = erg?.felder ?? [];
  const offen = felder.filter((f) => !(f.erkannt || f.bestaetigt || f.nicht_erforderlich));
  const erkannt = felder.filter((f) => f.erkannt).length;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onSchliessen()}
      title="Scan-Auswertung"
      description={`${vorgang.name} · ${vorgang.doc_uid}`}
      className="w-[min(44rem,calc(100vw-2rem))]"
      footer={
        <>
          {vorgang.scan_pfad && (
            <Button variant="outline" onClick={onScanAnsehen}>
              <ScanLine className="me-1.5 h-3.5 w-3.5" aria-hidden />
              Scan ansehen
            </Button>
          )}
          <Button onClick={onSchliessen}>Schließen</Button>
        </>
      }
    >
      {!erg ? (
        <p className="text-sm text-[var(--fg-muted)]">Noch nicht geprüft.</p>
      ) : !erg.qr_ok ? (
        <p className="text-sm text-[var(--danger)]">
          Der QR-Code auf dem Scan war nicht lesbar — bitte das Blatt gerade und hell genug scannen.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={vorgang.vollstaendig ? "status-ok" : "status-bad"}>
              {vorgang.vollstaendig ? "Vollständig" : `${offen.length} offen`}
            </Badge>
            <span className="text-[var(--fg-muted)]">
              {felder.length} Prüfpunkt(e) · {erkannt} automatisch erkannt
            </span>
          </div>
          <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto">
            {felder.map((f) => (
              <PruefFeld
                key={f.key}
                feld={f}
                darfSchreiben={darfSchreiben}
                laeuft={laeuft}
                onSetzen={(status, kommentar) => onFeld(f.key, status, kommentar)}
              />
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

/** Eine Zeile der Scan-Auswertung mit den Pro-Feld-Aktionen. */
function PruefFeld({
  feld,
  darfSchreiben,
  laeuft,
  onSetzen,
}: {
  feld: Feld;
  darfSchreiben: boolean;
  laeuft: boolean;
  onSetzen: (status: FeldStatus, kommentar?: string | null) => void;
}) {
  const [kommentiert, setKommentiert] = useState(false);
  const [text, setText] = useState(feld.kommentar ?? "");
  const erledigt = feld.erkannt || feld.bestaetigt || feld.nicht_erforderlich;
  const zustand = feld.erkannt
    ? "automatisch erkannt"
    : feld.bestaetigt
      ? "von Hand bestätigt"
      : feld.nicht_erforderlich
        ? "nicht erforderlich"
        : "fehlt";

  return (
    <li className="rounded-md border border-[var(--border)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        {erledigt ? (
          <Check className="h-4 w-4 shrink-0 text-[var(--ok)]" aria-hidden />
        ) : (
          <X className="h-4 w-4 shrink-0 text-[var(--danger)]" aria-hidden />
        )}
        <span className={erledigt ? "text-sm" : "text-sm font-medium"}>{feld.label}</span>
        <span className="text-xs text-[var(--fg-muted)]">· {zustand}</span>
        {darfSchreiben && !feld.erkannt && (
          <div className="ms-auto flex flex-wrap gap-1">
            {!feld.bestaetigt && !feld.nicht_erforderlich ? (
              <>
                <Button size="sm" variant="outline" disabled={laeuft} onClick={() => onSetzen("bestaetigt")}>
                  Bestätigen
                </Button>
                <Button size="sm" variant="ghost" disabled={laeuft} onClick={() => setKommentiert((k) => !k)}>
                  Nicht erforderlich
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={laeuft} onClick={() => onSetzen("offen")}>
                Zurücksetzen
              </Button>
            )}
          </div>
        )}
      </div>

      {feld.nicht_erforderlich && feld.kommentar && (
        <p className="mt-1 ps-6 text-xs italic text-[var(--fg-muted)]">„{feld.kommentar}“</p>
      )}

      {kommentiert && (
        <div className="mt-2 flex flex-wrap items-center gap-2 ps-6">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Grund, z. B. entfällt für diesen Vorgang"
            aria-label="Grund für „nicht erforderlich“"
            className="min-w-64 flex-1 text-sm"
          />
          <Button
            size="sm"
            disabled={laeuft || !text.trim()}
            onClick={() => {
              setKommentiert(false);
              onSetzen("nicht_erforderlich", text.trim());
            }}
          >
            Abschließen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setKommentiert(false)}>
            Abbrechen
          </Button>
        </div>
      )}
    </li>
  );
}
