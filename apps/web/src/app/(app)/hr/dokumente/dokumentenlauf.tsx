"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileDown, FileUp, Plus, ScanLine, X } from "lucide-react";

import {
  WEG,
  dokumentApi,
  dokumentKeys,
  naechste,
  type Art,
  type Stand,
  type Vorgang,
} from "@/lib/dokumente";
import { onboardingApi, onboardingKeys } from "@/lib/onboarding";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { useDokumentworte } from "@/lib/tafeln";



/**
 * Der Dokumentenlauf.
 *
 * Ein Blatt wird erzeugt, ausgehändigt, ausgefüllt zurückgegeben und geprüft.
 * Im Altprojekt endet die Sache beim Herunterladen: danach weiß niemand, ob
 * das Blatt zurückkam. Hier hält der Vorgang es fest, und der QR-Code darauf
 * ordnet den Scan wieder zu — unabhängig von Dateiname und Schreibweise.
 *
 * Die Prüfung sieht, **ob** in einem Feld etwas steht, nicht was. Deshalb
 * steht das Urteil daneben zum Überstimmen: wer das Blatt in der Hand hatte,
 * weiß es besser.
 */
export function Dokumentenlauf({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const dokumentworte = useDokumentworte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "short" });
  const queryClient = useQueryClient();
  const [art, setArt] = useState<Art>("einarbeitung");
  const [person, setPerson] = useState<string>("");
  const [filter, setFilter] = useState<Stand | "alle">("alle");
  const [offen, setOffen] = useState<string | null>(null);

  const vorgaenge = useQuery({ queryKey: dokumentKeys.liste(), queryFn: dokumentApi.liste });
  const eintritte = useQuery({
    queryKey: onboardingKeys.eintritte(),
    queryFn: onboardingApi.eintritte,
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["dokumente"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const anlegen = useMutation({
    mutationFn: () => {
      const [wie, wert] = person.split(":");
      return dokumentApi.anlegen({
        art,
        employee_id: wie === "e" ? Number(wert) : null,
        extern_id: wie === "x" ? wert : null,
      });
    },
    onSuccess: (v) => {
      toast.success(`Blatt ${v.doc_uid} erzeugt.`);
      setOffen(v.id);
      return neuLaden();
    },
    onError: melde,
  });

  const weiter = useMutation({
    mutationFn: ({ id, ziel }: { id: string; ziel: Stand }) => dokumentApi.weiter(id, ziel),
    onSuccess: neuLaden,
    onError: melde,
  });

  const scan = useMutation({
    mutationFn: ({ id, datei }: { id: string; datei: File }) => dokumentApi.scan(id, datei),
    onSuccess: (v) => {
      toast[v.vollstaendig ? "success" : "warning"](
        v.vollstaendig
          ? "Scan geprüft — alle Felder ausgefüllt."
          : `Scan geprüft — ${v.pruef_ergebnis?.fehlend.length ?? 0} Feld(er) leer.`,
      );
      return neuLaden();
    },
    onError: melde,
  });

  const urteilen = useMutation({
    mutationFn: ({ id, wert }: { id: string; wert: boolean }) =>
      dokumentApi.urteil(id, wert, null),
    onSuccess: neuLaden,
    onError: melde,
  });

  const oeffnen = useMutation({
    mutationFn: ({ id, was }: { id: string; was: "blatt.pdf" | "scan" }) =>
      dokumentApi.oeffnen(id, was),
    onError: melde,
  });

  const liste = useMemo(
    () => (vorgaenge.data ?? []).filter((v) => filter === "alle" || v.status === filter),
    [vorgaenge.data, filter],
  );

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.dokumentenlauf.einleitung}
        unter={
          <div className="mt-2 flex justify-start gap-4 text-sm">
            <Link href="/hr/onboarding" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/onboarding"]}
            </Link>
            <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/schulungen"]}
            </Link>
          </div>
        }
      />

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1">
            <label htmlFor="neu-art" className="text-sm font-medium">
              {worte.dokumentenlauf.formblatt}
            </label>
            <Select
              id="neu-art"
              value={art}
              className="w-56"
              onChange={(e) => setArt(e.target.value as Art)}
            >
              {(Object.keys(dokumentworte.art) as Art[]).map((a) => (
                <option key={a} value={a}>
                  {dokumentworte.art[a]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="neu-person" className="text-sm font-medium">
              {worte.dokumentenlauf.fuerWen}
            </label>
            <Select
              id="neu-person"
              value={person}
              className="w-72"
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">{worte.dokumentenlauf.personWaehlen}</option>
              {(eintritte.data ?? []).map((p) => (
                <option
                  key={p.employee_id ?? p.extern_id}
                  value={p.employee_id !== null ? `e:${p.employee_id}` : `x:${p.extern_id}`}
                >
                  {p.name}
                  {p.abteilung ? ` · ${p.abteilung}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <Button disabled={!person || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {anlegen.isPending ? worte.dokumentenlauf.erzeugt : worte.dokumentenlauf.blattErzeugen}
          </Button>
        </Card>
      )}

      <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
        <span className="text-[var(--fg-muted)]">{worte.dokumentenlauf.standFilter}</span>
        {(["alle", ...WEG] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? "default" : "outline"}
            onClick={() => setFilter(s as Stand | "alle")}
          >
            {s === "alle" ? worte.dokumentenlauf.alle : dokumentworte.stand[s as Stand]}
          </Button>
        ))}
        <span className="ms-auto text-[var(--fg-muted)]">
          {worte.dokumentenlauf.vonGesamt(liste.length, vorgaenge.data?.length ?? 0)}
        </span>
      </Card>

      {vorgaenge.error && (
        <p className="text-sm text-[var(--danger)]">{(vorgaenge.error as Error).message}</p>
      )}

      {!vorgaenge.isPending && liste.length === 0 ? (
        <EmptyState
          title={worte.dokumentenlauf.keinVorgang}
          body={worte.dokumentenlauf.keinVorgangText}
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.dokumentenlauf.person}</Th>
                <Th>{worte.dokumentenlauf.formblatt}</Th>
                <Th>{worte.dokumentenlauf.kennung}</Th>
                <Th>{worte.dokumentenlauf.stand}</Th>
                <Th>{worte.dokumentenlauf.vollstaendigSpalte}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {liste.map((v) => (
                <tr key={v.id} className="align-top">
                  <Td>
                    <span className="font-medium">{v.name}</span>
                    {v.funktion && (
                      <span className="block text-xs text-[var(--fg-muted)]">{v.funktion}</span>
                    )}
                  </Td>
                  <Td>{dokumentworte.art[v.art]}</Td>
                  <Td className="font-mono text-xs">{v.doc_uid}</Td>
                  <Td>
                    <Badge variant={v.status === "geprueft" ? "default" : "outline"}>
                      {dokumentworte.stand[v.status]}
                    </Badge>
                    <span className="mt-1 block text-xs text-[var(--fg-muted)]">
                      {DATUM.format(new Date(v.erstellt_am))}
                    </span>
                  </Td>
                  <Td>
                    <Urteil
                      vorgang={v}
                      darfSchreiben={darfSchreiben}
                      laeuft={urteilen.isPending}
                      umkehren={(wert) => urteilen.mutate({ id: v.id, wert })}
                    />
                  </Td>
                  <Td className="text-end">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => oeffnen.mutate({ id: v.id, was: "blatt.pdf" })}
                      >
                        <FileDown className="me-1.5 h-3.5 w-3.5" aria-hidden />
                        {worte.dokumentenlauf.blatt}
                      </Button>
                      {v.scan_pfad && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => oeffnen.mutate({ id: v.id, was: "scan" })}
                        >
                          {worte.dokumentenlauf.scan}
                        </Button>
                      )}
                      {darfSchreiben && naechste(v.status) && v.status !== "zurueck" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={weiter.isPending}
                          onClick={() =>
                            weiter.mutate({ id: v.id, ziel: naechste(v.status)! })
                          }
                        >
                          {dokumentworte.stand[naechste(v.status)!]}
                        </Button>
                      )}
                      {darfSchreiben && (
                        <label
                          className={
                            "inline-flex h-8 cursor-pointer items-center rounded-md border " +
                            "border-[var(--border)] px-3 text-xs font-medium " +
                            "hover:bg-[var(--muted)] focus-within:outline-2 " +
                            "focus-within:outline-[var(--ring)]"
                          }
                        >
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOffen(offen === v.id ? null : v.id)}
                      >
                        {offen === v.id ? worte.dokumentenlauf.zu : worte.dokumentenlauf.details}
                      </Button>
                    </div>
                    {offen === v.id && <Details vorgang={v} darfSchreiben={darfSchreiben} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
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
          disabled={laeuft}
          onClick={() => umkehren(!vorgang.vollstaendig)}
        >
          {vorgang.vollstaendig ? (
            <X className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden />
          )}
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

  return (
    <div className="mt-3 space-y-3 rounded-md border border-[var(--border)] p-3 text-start">
      <div className="flex flex-wrap gap-4 text-xs text-[var(--fg-muted)]">
        {WEG.map((s) => {
          const wann = vorgang[STEMPEL[s]];
          return (
            <span key={s}>
              {dokumentworte.stand[s]}:{" "}
              {typeof wann === "string" ? DATUM.format(new Date(wann)) : "—"}
            </span>
          );
        })}
      </div>

      {vorgang.pruef_ergebnis && (
        <div>
          <p className="text-sm font-medium">
            {worte.dokumentenlauf.pruefung}{" "}
            <span className="font-normal text-[var(--fg-muted)]">
              {vorgang.pruef_ergebnis.qr_ok
                ? worte.dokumentenlauf.qrGelesen
                : worte.dokumentenlauf.keinQr}
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
        <ul className="mt-1 space-y-1 text-xs text-[var(--fg-muted)]">
          {(nachweise.data ?? []).map((n) => (
            <li key={n.id}>
              {n.dateiname}
              {n.zeile ? ` · ${n.zeile}` : ""} · {DATUM.format(new Date(n.hochgeladen_am))}
            </li>
          ))}
          {nachweise.data?.length === 0 && <li>{worte.dokumentenlauf.keineNachweise}</li>}
        </ul>
        {darfSchreiben && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={zeile}
              placeholder={worte.dokumentenlauf.welcheZeile}
              className="w-64 text-xs"
              onChange={(e) => setZeile(e.target.value)}
            />
            <label
              className={
                "inline-flex h-8 cursor-pointer items-center rounded-md border " +
                "border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--muted)] " +
                "focus-within:outline-2 focus-within:outline-[var(--ring)]"
              }
            >
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
