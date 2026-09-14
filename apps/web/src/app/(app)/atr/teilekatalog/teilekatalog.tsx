"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Plus } from "lucide-react";

import {
  XLSX_TYP,
  atrApi,
  atrKeys,
  gewichtAusEingabe,
  type ImportErgebnis,
  type Teil,
} from "@/lib/atr";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";
import { Seitenwerkzeuge, useInSchale, Werkzeug } from "@/components/sidebar/werkzeugplatz";
import { Bereichswahl } from "../bereichswahl";

/** Eine feste leere Menge: eine neue je Render hielte die Tabelle auf Seite 1. */
const KEINE: Teil[] = [];

/**
 * Der Teilekatalog: was ein Teil heißt, wiegt und zu welcher Zeichnung es
 * gehört. Ein Lieferschein findet sein Teil später über die normierte
 * Teilenummer — nur die Ziffern, weil sie auf dem Lieferschein anders
 * geschrieben steht als im Katalog.
 *
 * Wie im Altsystem (ATR-04): eine Zeile ist zuerst Anzeige. „Bearbeiten“ macht
 * Bezeichnung, Zeichnung und Gewicht zu Feldern, „Speichern“ übernimmt sie —
 * Tippen und Verlassen eines Feldes speichern nichts. Teilenummer und
 * Kategorie bleiben Text.
 */
export function Teilekatalog({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const queryClient = useQueryClient();
  const [neueNummer, setNeueNummer] = useState("");
  const [bericht, setBericht] = useState<ImportErgebnis | null>(null);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState({ bezeichnung: "", zeichnung: "", gewicht: "" });
  const [fehler, setFehler] = useState<string | null>(null);

  const teile = useQuery({ queryKey: atrKeys.teile(), queryFn: atrApi.teile });
  const liste = teile.data ?? KEINE;

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

  const einlesen = useMutation({
    mutationFn: (datei: File) => atrApi.referenzEinlesen(datei),
    onSuccess: (e) => {
      setBericht(e);
      toast.success(`${e.teile_neu} neu, ${e.teile_aktualisiert} aktualisiert.`);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const anlegen = useMutation({
    mutationFn: () => atrApi.teilAnlegen(neueNummer.trim()),
    onSuccess: () => {
      setNeueNummer("");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const speichern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Partial<Teil> }) =>
      atrApi.teilAendern(id, felder),
    onSuccess: () => {
      setBearbeitet(null);
      setFehler(null);
      toast.success(worte.atr.gespeichert);
      return neuLaden();
    },
    // Kein Erfolg vortäuschen: die Zeile bleibt offen, der Grund steht darunter.
    onError: (f: Error) => setFehler(worte.atr.nichtGespeichert(f.message)),
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => atrApi.teilLoeschen(id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  function bearbeiten(t: Teil) {
    setBearbeitet(t.id);
    setFehler(null);
    setEntwurf({
      bezeichnung: t.bezeichnung ?? "",
      zeichnung: t.zeichnung ?? "",
      gewicht: t.gewicht_kg ?? "",
    });
  }

  function uebernehmen(t: Teil) {
    const gewicht = gewichtAusEingabe(entwurf.gewicht);
    if ("fehler" in gewicht) {
      setFehler(worte.atr.gewichtUngueltig);
      return;
    }
    speichern.mutate({
      id: t.id,
      felder: {
        bezeichnung: entwurf.bezeichnung.trim() || null,
        zeichnung: entwurf.zeichnung.trim() || null,
        gewicht_kg: gewicht.wert,
      },
    });
  }

  const feld = (t: Teil, name: keyof typeof entwurf, titel: string, breite?: string) => (
    <Input
      className={breite}
      value={entwurf[name]}
      aria-label={`${titel} ${t.teilenummer}`}
      onChange={(e) => setEntwurf((alt) => ({ ...alt, [name]: e.target.value }))}
    />
  );

  const spalten: Tabellenspalte<Teil>[] = [
    {
      schluessel: "teilenummer",
      titel: worte.atr.teilenummer,
      typ: "text",
      wert: (t) => t.teilenummer,
      // Die normierte Nummer steht nicht mehr sichtbar da (ATR-05), sucht aber
      // weiter mit: wer „1234/56“ tippt, findet „VR-1234-56“. Treffen die
      // Ziffern der Eingabe, gilt die Eingabe selbst als Fundstelle.
      suchtext: (t, gesucht) => {
        const ziffern = gesucht.replace(/\D/g, "");
        return ziffern && t.teilenummer_norm?.includes(ziffern) ? gesucht : t.teilenummer;
      },
      zelle: (t) => <span className="font-medium">{t.teilenummer}</span>,
    },
    {
      schluessel: "bezeichnung",
      titel: worte.atr.bezeichnung,
      typ: "text",
      wert: (t) => t.bezeichnung,
      zelle: (t) =>
        t.id === bearbeitet ? feld(t, "bezeichnung", worte.atr.bezeichnung) : (t.bezeichnung ?? "—"),
    },
    {
      schluessel: "zeichnung",
      titel: worte.atr.zeichnung,
      typ: "text",
      wert: (t) => t.zeichnung,
      zelle: (t) =>
        t.id === bearbeitet
          ? feld(t, "zeichnung", worte.atr.zeichnung, "w-40")
          : (t.zeichnung ?? "—"),
    },
    {
      schluessel: "gewicht_kg",
      titel: worte.atr.gewicht,
      typ: "zahl",
      ausrichtung: "end",
      wert: (t) => (t.gewicht_kg == null ? null : Number(t.gewicht_kg)),
      suchtext: (t) => t.gewicht_kg,
      zelle: (t) =>
        t.id === bearbeitet
          ? feld(t, "gewicht", worte.atr.gewicht, "w-24 text-end")
          : (t.gewicht_kg ?? "—"),
    },
    {
      schluessel: "kategorie",
      titel: worte.atr.kategorie,
      typ: "text",
      wert: (t) => t.kategorie,
    },
  ];

  if (darfSchreiben) {
    spalten.push({
      schluessel: "aktionen",
      titel: "",
      typ: "text",
      wert: () => null,
      suchtext: false,
      sortierbar: false,
      ausrichtung: "end",
      zelle: (t) => (
        <div className="flex items-center justify-end gap-1">
          {t.id === bearbeitet ? (
            <Button size="sm" onClick={() => uebernehmen(t)} disabled={speichern.isPending}>
              {worte.atr.speichern}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => bearbeiten(t)}>
              {worte.atr.bearbeiten}
            </Button>
          )}
          <ConfirmDeleteButton
            itemLabel={t.teilenummer}
            onConfirm={() => loeschen.mutateAsync(t.id).then(() => undefined)}
          />
        </div>
      ),
    });
  }

  return (
    <div className="space-y-6">
      <Seitenkopf untertitel={worte.atr.einleitung} links={<Bereichswahl aktiv="teilekatalog" />} />

      {/* Anlegen und Einlesen gelten für den ganzen Katalog: in der Schale
          stehen sie in der rechten Leiste, der Bericht bleibt auf der Seite. */}
      {darfSchreiben && (
        <Seitenwerkzeuge kategorie="aktionen">
          <div className="flex flex-col items-stretch gap-2">
            {/* In der Leiste trägt der Werkzeugtitel die Beschriftung. */}
            <Werkzeug titel={worte.atr.teilAnlegen}>
              <div className="flex flex-col gap-1">
                {!inSchale && <Label htmlFor="neu">{worte.atr.teilAnlegen}</Label>}
                <Input
                  id="neu"
                  aria-label={worte.atr.teilAnlegen}
                  value={neueNummer}
                  placeholder={worte.atr.teilBeispiel}
                  onChange={(e) => setNeueNummer(e.target.value)}
                />
              </div>
            </Werkzeug>
            <Button
              disabled={!neueNummer.trim() || anlegen.isPending}
              onClick={() => anlegen.mutate()}
            >
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {worte.atr.anlegen}
            </Button>
            <label
              className={
                "inline-flex h-9 cursor-pointer items-center justify-center rounded-md border " +
                "border-[var(--border)] px-4 text-sm font-medium " +
                "hover:bg-[var(--muted)] focus-within:outline-2 focus-within:outline-[var(--ring)]"
              }
            >
              <FileUp className="me-2 h-4 w-4" aria-hidden />
              {einlesen.isPending ? worte.atr.wirdGelesen : worte.atr.mappeEinlesen}
              <input
                type="file"
                accept={`.xlsx,${XLSX_TYP}`}
                className="sr-only"
                aria-label={worte.atr.mappeEinlesen}
                disabled={einlesen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) einlesen.mutate(datei);
                }}
              />
            </label>
          </div>
        </Seitenwerkzeuge>
      )}

      {darfSchreiben && bericht && (
        <Card className="p-4">
            <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
              <p>
                <span className="font-medium">{bericht.dateiname}</span>:{" "}
                {bericht.teile_gelesen} Teile gelesen, {bericht.teile_neu} neu,{" "}
                {bericht.teile_aktualisiert} aktualisiert
                {bericht.vorlage_uebernommen && ` · Vorlage ${bericht.programm} übernommen`}.
              </p>
              {bericht.hinweise.length > 0 && (
                <ul className="mt-1 list-disc ps-5 text-[var(--fg-muted)]">
                  {bericht.hinweise.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
        </Card>
      )}

      <Datentabelle
        zeilen={liste}
        spalten={spalten}
        zeilenSchluessel={(t) => t.id}
        vorsortierung={{ spalte: "teilenummer", richtung: "auf" }}
        laedt={teile.isLoading}
        leer={`${worte.atr.katalogLeer}. ${worte.atr.katalogLeerText}`}
        beschriftung={worte.atr.teilekatalog}
        unterZeile={(t) =>
          t.id === bearbeitet && fehler ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {fehler}
            </p>
          ) : null
        }
      />
    </div>
  );
}
