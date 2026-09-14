"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Download, FileCog } from "lucide-react";

import {
  formatPoPos,
  gewichtAusEingabe,
  lieferungApi,
  lieferungKeys,
  seriennummernAbweichung,
  seriennummernAusText,
  type AtrPosition,
  type Lieferung,
} from "@/lib/atr";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useTexte } from "@/components/sprache/anbieter";
import { cn } from "@/lib/cn";
import { Seitenwerkzeuge } from "@/components/sidebar/werkzeugplatz";
import type { Texte } from "@/texte";
import { StatusAbzeichen } from "../../status-abzeichen";

/**
 * Durchsicht einer Lieferung: Kopfdaten ergänzen, Positionen prüfen,
 * Dokumente erzeugen.
 *
 * Die Zustände sind die des Altsystems (ATR-09): Entwurf, erzeugt, abgelegt.
 * Keiner sperrt die Positionen — Seriennummern und Gewichte werden auch nach
 * der Erzeugung nachgetragen, und die Dokumente dann neu erzeugt.
 */
const ZEIT = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});

/** Die drei erzeugten Dateien. */
const AUSGABEN = [
  { feld: "mappe_pfad", name: "Mappe", dateiname: "ATR.xlsx" },
  { feld: "pdf_pfad", name: "PDF", dateiname: "ATR.pdf" },
  { feld: "etikett_pfad", name: "Etikett", dateiname: "Etikett.docx" },
] as const;

/** Die PO-Nummer heißt wie im Altsystem (ATR-07); sie kommt aus den
 *  Bestelldaten des Lieferscheins. */
const KOPFFELDER: { feld: keyof Lieferung; wort: keyof Texte["durchsicht"]; typ?: string }[] = [
  { feld: "atr_nummer", wort: "atrNummer" },
  { feld: "containernummer", wort: "containernummer" },
  { feld: "bestellnummer", wort: "poNummer" },
  { feld: "satz_titel", wort: "satzTitel" },
  { feld: "programm", wort: "programm" },
  { feld: "msn", wort: "msn" },
  { feld: "bereich", wort: "bereich" },
  { feld: "wiegedatum", wort: "wiegedatum", typ: "date" },
  { feld: "pruefdatum", wort: "pruefdatum", typ: "date" },
  { feld: "qs_unterschrift", wort: "qsUnterschrift" },
  { feld: "max_gewicht_kg", wort: "hoechstgewicht" },
];

const KEINE: AtrPosition[] = [];

export function Durchsicht({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const worte = useTexte();
  const queryClient = useQueryClient();

  const lieferung = useQuery({
    queryKey: lieferungKeys.eine(id),
    queryFn: () => lieferungApi.eine(id),
  });
  const positionen = useQuery({
    queryKey: lieferungKeys.positionen(id),
    queryFn: () => lieferungApi.positionen(id),
  });

  const l = lieferung.data;
  const zeilen = positionen.data ?? KEINE;

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

  // Wie im Altsystem: eine Position speichert beim Verlassen ihres Feldes.
  const positionAendern = useMutation({
    mutationFn: ({ pid, felder }: { pid: string; felder: Partial<AtrPosition> }) =>
      lieferungApi.positionAendern(pid, felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const positionLoeschen = useMutation({
    mutationFn: (pid: string) => lieferungApi.positionLoeschen(pid),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const erzeugen = useMutation({
    mutationFn: () => lieferungApi.erzeugen(id),
    onSuccess: (e) => {
      toast.success(
        e.pdf_hinweis ? "Mappe und Etikett erzeugt." : "Mappe, PDF und Etikett erzeugt.",
      );
      if (e.pdf_hinweis) toast.error(e.pdf_hinweis);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const herunterladen = useMutation({
    mutationFn: async ({ pfad, name }: { pfad: string; name: string }) => {
      const url = await lieferungApi.dateiUrl(pfad);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  if (lieferung.isLoading) {
    return <p className="text-sm text-[var(--fg-muted)]">Wird geladen …</p>;
  }
  if (!l) {
    return <p className="text-sm text-[var(--fg-muted)]">{worte.durchsicht.nichtGefunden}</p>;
  }

  const gesamtgewicht = zeilen.reduce(
    (summe, p) => summe + (p.gewicht_kg ? Number(p.gewicht_kg) * p.menge : 0),
    0,
  );
  const ohneGewicht = zeilen.filter((p) => !p.gewicht_kg).length;
  const ohneKatalog = zeilen.filter((p) => !p.teil_id).length;

  const posName = (p: AtrPosition) => String(p.pos ?? p.reihenfolge);

  const textfeld = (p: AtrPosition, feld: "bezeichnung" | "zeichnung", titel: string, breite?: string) => (
    <Input
      className={breite}
      defaultValue={p[feld] ?? ""}
      aria-label={`${titel} Position ${posName(p)}`}
      placeholder="—"
      disabled={!darfSchreiben}
      onBlur={(e) => {
        const wert = e.target.value.trim() || null;
        if (wert !== p[feld]) positionAendern.mutate({ pid: p.id, felder: { [feld]: wert } });
      }}
    />
  );

  const spalten: Tabellenspalte<AtrPosition>[] = [
    {
      schluessel: "pos",
      titel: worte.durchsicht.pos,
      typ: "zahl",
      wert: (p) => p.pos,
      className: "w-14 tabular-nums",
    },
    {
      schluessel: "teilenummer",
      titel: worte.atr.teilenummer,
      typ: "text",
      wert: (p) => p.teilenummer,
      zelle: (p) => (
        <>
          <span className="font-medium">{p.teilenummer ?? "—"}</span>
          {!p.teil_id && (
            <span className="mt-0.5 block text-xs text-[var(--fg-muted)]">
              {worte.durchsicht.nichtImKatalog}
            </span>
          )}
        </>
      ),
    },
    {
      schluessel: "bezeichnung",
      titel: worte.atr.bezeichnung,
      typ: "text",
      wert: (p) => p.bezeichnung,
      zelle: (p) => textfeld(p, "bezeichnung", worte.atr.bezeichnung),
    },
    {
      schluessel: "zeichnung",
      titel: worte.atr.zeichnung,
      typ: "text",
      wert: (p) => p.zeichnung,
      zelle: (p) => textfeld(p, "zeichnung", worte.atr.zeichnung, "w-40"),
    },
    {
      schluessel: "menge",
      titel: worte.durchsicht.menge,
      typ: "zahl",
      ausrichtung: "end",
      wert: (p) => p.menge,
    },
    {
      schluessel: "gewicht_kg",
      titel: worte.atr.gewicht,
      typ: "zahl",
      wert: (p) => (p.gewicht_kg == null ? null : Number(p.gewicht_kg)),
      suchtext: (p) => p.gewicht_kg,
      zelle: (p) => (
        <Input
          className="w-24"
          defaultValue={p.gewicht_kg ?? ""}
          aria-label={`${worte.atr.gewicht} Position ${posName(p)}`}
          placeholder="—"
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const gewicht = gewichtAusEingabe(e.target.value);
            if ("fehler" in gewicht) {
              toast.error(worte.atr.gewichtUngueltig);
            } else if (gewicht.wert !== p.gewicht_kg) {
              positionAendern.mutate({ pid: p.id, felder: { gewicht_kg: gewicht.wert } });
            }
          }}
        />
      ),
    },
    {
      // ATR-07: die PO-Position aus „Auftrag Nr. <BA> / <Pos>“, wie im
      // Altsystem mit führenden Nullen gezeigt. Gespeichert bleibt, was dasteht.
      schluessel: "bestellposition",
      titel: worte.durchsicht.poPos,
      typ: "text",
      wert: (p) => formatPoPos(p.bestellposition) || null,
      className: "tabular-nums",
    },
    {
      // ATR-08: wie im Altsystem ein kommagetrenntes Feld je Position; passt
      // die Anzahl nicht zur Menge, wird das Feld rot und sagt, warum.
      schluessel: "seriennummern",
      titel: worte.durchsicht.seriennummern,
      typ: "text",
      wert: (p) => p.seriennummern.join(", "),
      zelle: (p) => {
        const abweichung = seriennummernAbweichung(p.seriennummern, p.menge);
        const hinweis = abweichung
          ? worte.durchsicht.seriennummernAbweichung(p.seriennummern.length, p.menge)
          : undefined;
        return (
          <div>
            <Input
              className={cn("w-56", abweichung && "border-[var(--danger)]")}
              defaultValue={p.seriennummern.join(", ")}
              aria-label={worte.durchsicht.seriennummernFeld(posName(p))}
              aria-invalid={abweichung}
              title={hinweis}
              disabled={!darfSchreiben}
              onBlur={(e) => {
                const neu = seriennummernAusText(e.target.value);
                if (neu.join("\n") !== p.seriennummern.join("\n")) {
                  positionAendern.mutate({ pid: p.id, felder: { seriennummern: neu } });
                }
              }}
            />
            {hinweis && <span className="mt-0.5 block text-xs text-[var(--danger)]">{hinweis}</span>}
          </div>
        );
      },
    },
  ];

  if (darfSchreiben) {
    spalten.push({
      schluessel: "loeschen",
      titel: "",
      typ: "text",
      wert: () => null,
      suchtext: false,
      sortierbar: false,
      ausrichtung: "end",
      zelle: (p) => (
        <ConfirmDeleteButton
          itemLabel={`Position ${posName(p)}`}
          onConfirm={() => positionLoeschen.mutateAsync(p.id).then(() => undefined)}
        />
      ),
    });
  }

  return (
    <div className="space-y-5">
      {/* Rückweg, Erzeugen und Herunterladen gelten für die ganze Lieferung:
          in der Schale stehen sie in der rechten Leiste. */}
      <Seitenwerkzeuge kategorie="navigation">
        <Link
          href="/atr"
          className="inline-flex items-center text-sm text-[var(--fg-muted)] underline-offset-4 hover:underline"
        >
          <ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" aria-hidden />
          {worte.atr.lieferungen}
        </Link>
      </Seitenwerkzeuge>
      <Seitenwerkzeuge kategorie="aktionen">
        <div className="flex flex-col items-stretch gap-2">
          {darfSchreiben && (
            <Button
              variant="outline"
              onClick={() => erzeugen.mutate()}
              disabled={erzeugen.isPending || zeilen.length === 0}
            >
              <FileCog className="me-2 h-4 w-4" aria-hidden />
              {erzeugen.isPending ? worte.durchsicht.wirdErzeugt : worte.durchsicht.dokumenteErzeugen}
            </Button>
          )}

          {AUSGABEN.map(({ feld, name, dateiname }) => {
            const pfad = l[feld] as string | null;
            return (
              <Button
                key={feld}
                variant="ghost"
                size="sm"
                disabled={!pfad}
                onClick={() =>
                  pfad &&
                  herunterladen.mutate({
                    pfad,
                    name: `${l.lieferschein_nr ?? "ATR"}_${dateiname}`,
                  })
                }
              >
                <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {name}
              </Button>
            );
          })}

          <span className="text-xs text-[var(--fg-muted)]">
            {!l.erzeugt_am
              ? "Noch nichts erzeugt."
              : new Date(l.erzeugt_am) < new Date(l.geaendert_am)
                ? `Erzeugt am ${ZEIT.format(new Date(l.erzeugt_am))} — die Lieferung wurde danach geändert.`
                : `Erzeugt am ${ZEIT.format(new Date(l.erzeugt_am))}.`}
          </span>
        </div>
      </Seitenwerkzeuge>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">
          Lieferschein {l.lieferschein_nr ?? l.quelle_dateiname}
        </h2>
        <StatusAbzeichen status={l.status} />
      </div>

      {l.programm_grund && (
        <p className="text-sm text-[var(--fg-muted)]">{l.programm_grund}</p>
      )}

      {l.hinweise.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-medium">Beim Einlesen aufgefallen</h2>
          <ul className="mt-2 list-disc ps-5 text-sm text-[var(--fg-muted)]">
            {l.hinweise.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Neu aufgesetzt, sobald die Lieferung gespeichert ist. */}
      <Kopfdaten key={l.geaendert_am} lieferung={l} darfSchreiben={darfSchreiben} />

      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-medium">{worte.durchsicht.positionen}</h2>
          <span className="text-sm text-[var(--fg-muted)]">
            {zeilen.length} Zeilen · {gesamtgewicht.toFixed(3).replace(".", ",")} kg
            {ohneKatalog > 0 && ` · ${ohneKatalog} nicht im Katalog`}
            {ohneGewicht > 0 && ` · ${ohneGewicht} ohne Gewicht`}
          </span>
        </div>

        <Datentabelle
          zeilen={zeilen}
          spalten={spalten}
          zeilenSchluessel={(p) => p.id}
          vorsortierung={{ spalte: "pos", richtung: "auf" }}
          laedt={positionen.isLoading}
          beschriftung={worte.durchsicht.positionen}
          zeilenKlasse={(p) => (p.teil_id ? undefined : "bg-[var(--muted)]")}
        />
      </Card>
    </div>
  );
}

/**
 * Die Kopfdaten. Wie im Altsystem ein Entwurf mit „Speichern“: die Felder
 * hängen zusammen (ATR-Nummer, Container, Wiegedatum), und ein halb
 * gespeicherter Kopf stünde sonst in der nächsten Mappe.
 */
function Kopfdaten({ lieferung: l, darfSchreiben }: { lieferung: Lieferung; darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const anfang = Object.fromEntries(
    KOPFFELDER.map(({ feld }) => [feld, ((l[feld] as string | null) ?? "").trim()]),
  );
  const [entwurf, setEntwurf] = useState<Record<string, string>>(anfang);
  const geaendert = KOPFFELDER.filter(({ feld }) => entwurf[feld].trim() !== anfang[feld]);

  const speichern = useMutation({
    mutationFn: () =>
      lieferungApi.aendern(
        l.id,
        Object.fromEntries(geaendert.map(({ feld }) => [feld, entwurf[feld].trim() || null])),
      ),
    onSuccess: () => {
      toast.success(worte.durchsicht.gespeichert);
      return queryClient.invalidateQueries({ queryKey: ["atr"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <Card className="p-5">
      <h2 className="font-medium">{worte.durchsicht.kopfdaten}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KOPFFELDER.map(({ feld, wort, typ }) => (
          <div key={feld} className="flex flex-col gap-1">
            <Label htmlFor={feld}>{worte.durchsicht[wort] as string}</Label>
            <Input
              id={feld}
              type={typ}
              value={entwurf[feld]}
              placeholder="—"
              disabled={!darfSchreiben}
              onChange={(e) => setEntwurf((alt) => ({ ...alt, [feld]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {darfSchreiben && (
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => speichern.mutate()}
            disabled={geaendert.length === 0 || speichern.isPending}
          >
            {worte.durchsicht.speichern}
          </Button>
        </div>
      )}
    </Card>
  );
}
