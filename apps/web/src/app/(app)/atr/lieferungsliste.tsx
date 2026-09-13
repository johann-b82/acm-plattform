"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, FolderSearch, Tag } from "lucide-react";

import {
  lieferungApi,
  lieferungKeys,
  scanApi,
  type Lieferung,
  type LieferscheinErgebnis,
} from "@/lib/atr";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Dialog } from "@/components/ui/dialog";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { Bereichswahl } from "./bereichswahl";
import { StatusAbzeichen, useStatusText } from "./status-abzeichen";

/** Eine feste leere Menge: eine neue je Render hielte die Tabelle auf Seite 1. */
const KEINE: Lieferung[] = [];

/**
 * Die eingelesenen Lieferscheine — der Einstieg in ATR (ATR-10).
 *
 * Mehrere Lieferungen lassen sich auswählen und bekommen gemeinsam eine
 * Containerbeschriftung (ATR-06). Die Auswahl hängt an der Kennung, nicht an
 * der Zeile: sie übersteht Suche, Sortierung und Seitenwechsel, und der Knopf
 * sagt, wie viele es sind — auch wenn gerade nicht alle zu sehen sind.
 */
export function Lieferungsliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const sprache = useSprache();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[sprache], { dateStyle: "medium" });
  const ZEIT = new Intl.DateTimeFormat(ZAHL_TAG[sprache], { dateStyle: "short", timeStyle: "short" });
  const statusText = useStatusText();
  const queryClient = useQueryClient();
  const [bericht, setBericht] = useState<LieferscheinErgebnis | null>(null);
  const [auswahl, setAuswahl] = useState<ReadonlySet<string>>(new Set());
  const [frage, setFrage] = useState(false);
  const [nummer, setNummer] = useState("");

  const lieferungen = useQuery({
    queryKey: lieferungKeys.liste(),
    queryFn: lieferungApi.liste,
  });
  const liste = lieferungen.data ?? KEINE;
  // Nur, was es noch gibt: eine inzwischen gelöschte Lieferung zählt nicht mit.
  const gewaehlt = liste.filter((l) => auswahl.has(l.id));

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

  // Derselbe Lauf wie der zeitgesteuerte, nur von Hand. Er steht hier und
  // nicht in den Einstellungen: einen liegen gebliebenen Lieferschein löst
  // aus, wer mit Lieferungen arbeitet, nicht die Plattform-Verwaltung.
  const durchsehen = useMutation({
    mutationFn: scanApi.lauf,
    onSuccess: (e) => {
      toast.success(
        e.gelesen === 0 ? "Nichts im Eingang." : `${e.gelesen} gelesen, ${e.angelegt} angelegt.`,
      );
      for (const hinweis of e.hinweise) toast.error(hinweis);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const einlesen = useMutation({
    mutationFn: (datei: File) => lieferungApi.einlesen(datei),
    onSuccess: (e) => {
      setBericht(e);
      toast.success(`${e.positionen} Positionen, ${e.zugeordnet} im Katalog gefunden.`);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (l: Lieferung) => lieferungApi.loeschen(l.id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const container = useMutation({
    mutationFn: ({ nr, ids }: { nr: string; ids: string[] }) => lieferungApi.containerEtikett(nr, ids),
    onSuccess: (_, { nr }) => {
      toast.success(worte.lieferungen.containerErstellt(nr));
      setAuswahl(new Set());
      setFrage(false);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  function umschalten(id: string, an: boolean) {
    setAuswahl((alt) => {
      const neu = new Set(alt);
      if (an) neu.add(id);
      else neu.delete(id);
      return neu;
    });
  }

  function containerFragen() {
    // Wie im Altsystem vorbelegt, wenn alle schon im selben Container liegen.
    const erste = gewaehlt[0]?.containernummer ?? "";
    setNummer(erste && gewaehlt.every((l) => (l.containernummer ?? "") === erste) ? erste : "");
    setFrage(true);
  }

  const name = (l: Lieferung) => l.lieferschein_nr ?? l.quelle_dateiname;

  const spalten: Tabellenspalte<Lieferung>[] = [];
  if (darfSchreiben) {
    spalten.push({
      schluessel: "auswahl",
      titel: "",
      typ: "text",
      wert: () => null,
      suchtext: false,
      sortierbar: false,
      className: "w-8",
      zelle: (l) => (
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--fg)]"
          checked={auswahl.has(l.id)}
          aria-label={worte.lieferungen.auswaehlen(name(l))}
          onChange={(e) => umschalten(l.id, e.target.checked)}
        />
      ),
    });
  }
  spalten.push(
    {
      schluessel: "lieferschein",
      titel: worte.lieferungen.lieferschein,
      typ: "text",
      wert: name,
      zelle: (l) => (
        <>
          <Link
            href={`/atr/lieferungen/${l.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {name(l)}
          </Link>
          {l.hinweise.length > 0 && (
            <span className="ms-2 text-xs text-[var(--warn)]">
              {l.hinweise.length} Hinweis{l.hinweise.length === 1 ? "" : "e"}
            </span>
          )}
        </>
      ),
    },
    {
      schluessel: "datum",
      titel: worte.lieferungen.datum,
      typ: "datum",
      wert: (l) => l.datum,
      suchtext: (l) => (l.datum ? DATUM.format(new Date(l.datum)) : null),
      zelle: (l) => (l.datum ? DATUM.format(new Date(l.datum)) : "—"),
    },
    { schluessel: "programm", titel: worte.lieferungen.programm, typ: "text", wert: (l) => l.programm },
    { schluessel: "msn", titel: worte.lieferungen.msn, typ: "text", wert: (l) => l.msn },
    { schluessel: "atr_nummer", titel: worte.lieferungen.atrNummer, typ: "text", wert: (l) => l.atr_nummer },
    {
      schluessel: "containernummer",
      titel: worte.lieferungen.containernummer,
      typ: "text",
      wert: (l) => l.containernummer,
    },
    {
      schluessel: "status",
      titel: worte.lieferungen.status,
      typ: "text",
      wert: (l) => statusText(l.status),
      zelle: (l) => <StatusAbzeichen status={l.status} />,
    },
    {
      schluessel: "erstellt_am",
      titel: worte.lieferungen.erstellt,
      typ: "datum",
      wert: (l) => l.erstellt_am,
      suchtext: false,
      zelle: (l) => (
        <span className="text-[var(--fg-muted)]">{ZEIT.format(new Date(l.erstellt_am))}</span>
      ),
    },
  );
  if (darfSchreiben) {
    spalten.push({
      schluessel: "loeschen",
      titel: "",
      typ: "text",
      wert: () => null,
      suchtext: false,
      sortierbar: false,
      ausrichtung: "end",
      zelle: (l) => (
        <ConfirmDeleteButton
          itemLabel={name(l)}
          onConfirm={() => loeschen.mutateAsync(l).then(() => undefined)}
        />
      ),
    });
  }

  return (
    <div className="space-y-6">
      <Seitenkopf untertitel={worte.lieferungen.einleitung} links={<Bereichswahl aktiv="lieferungen" />} />

      {darfSchreiben && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={
                "inline-flex h-9 cursor-pointer items-center rounded-md bg-[var(--fg)] " +
                "px-4 text-sm font-medium text-[var(--bg)] hover:opacity-90 " +
                "focus-within:outline-2 focus-within:outline-[var(--ring)]"
              }
            >
              <FileUp className="me-2 h-4 w-4" aria-hidden />
              {einlesen.isPending ? worte.lieferungen.wirdGelesen : worte.lieferungen.einlesen}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label={worte.lieferungen.einlesen}
                disabled={einlesen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) einlesen.mutate(datei);
                }}
              />
            </label>

            <Button
              variant="outline"
              onClick={() => durchsehen.mutate()}
              disabled={durchsehen.isPending}
            >
              <FolderSearch className="me-2 h-4 w-4" aria-hidden />
              {durchsehen.isPending ? worte.lieferungen.laeuft : worte.lieferungen.eingangDurchsehen}
            </Button>
          </div>

          {bericht && (
            <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
              <p>
                <span className="font-medium">{bericht.dateiname}</span>
                {bericht.lieferschein_nr && worte.lieferungen.berichtNummer(bericht.lieferschein_nr)}
                : {worte.lieferungen.berichtZeile(bericht.positionen, bericht.zugeordnet)}
              </p>
              <p className="mt-1 text-[var(--fg-muted)]">{bericht.programm_grund}</p>
              {bericht.hinweise.length > 0 && (
                <ul className="mt-1 list-disc ps-5 text-[var(--fg-muted)]">
                  {bericht.hinweise.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      <Datentabelle
        zeilen={liste}
        spalten={spalten}
        zeilenSchluessel={(l) => l.id}
        vorsortierung={{ spalte: "erstellt_am", richtung: "ab" }}
        laedt={lieferungen.isLoading}
        leer={
          darfSchreiben
            ? worte.lieferungen.keinLieferscheinSchreiben
            : worte.lieferungen.keinLieferscheinLesen
        }
        beschriftung={worte.atr.lieferungen}
        werkzeuge={
          darfSchreiben && (
            <>
              <Button
                variant="outline"
                disabled={gewaehlt.length === 0 || container.isPending}
                onClick={containerFragen}
              >
                <Tag className="me-2 h-4 w-4" aria-hidden />
                {worte.lieferungen.containerbeschriftung}
                {gewaehlt.length > 0 && ` (${gewaehlt.length})`}
              </Button>
              {gewaehlt.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setAuswahl(new Set())}>
                  {worte.lieferungen.auswahlAufheben}
                </Button>
              )}
            </>
          )
        }
      />

      <Dialog
        open={frage}
        onOpenChange={(offen) => !container.isPending && setFrage(offen)}
        title={worte.lieferungen.containerbeschriftung}
        description={worte.lieferungen.containerHinweis}
        footer={
          <>
            <Button variant="outline" onClick={() => setFrage(false)} disabled={container.isPending}>
              {worte.allgemein.abbrechen}
            </Button>
            <Button
              disabled={!nummer.trim() || container.isPending}
              onClick={() => container.mutate({ nr: nummer.trim(), ids: gewaehlt.map((l) => l.id) })}
            >
              {worte.lieferungen.erstellen}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="containernummer">{worte.lieferungen.containerFrage}</Label>
          <Input
            id="containernummer"
            value={nummer}
            maxLength={40}
            autoFocus
            onChange={(e) => setNummer(e.target.value)}
          />
          <p className="text-xs text-[var(--fg-muted)]">
            {worte.lieferungen.ausgewaehlt(gewaehlt.length)}: {gewaehlt.map(name).join(", ")}
          </p>
        </div>
      </Dialog>
    </div>
  );
}
