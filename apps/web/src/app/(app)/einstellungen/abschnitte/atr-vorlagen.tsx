"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import { XLSX_TYP, atrApi, atrKeys, type Vorlage } from "@/lib/atr";
import { Button, Card, EmptyState, Input, Label } from "@/components/ui/primitives";
import { Hinweis } from "@/components/ui/hinweis";
import { useTexte } from "@/components/sprache/anbieter";
import type { Texte } from "@/texte";

/**
 * Die Vorlage je Programm: Kopfdaten, die in jedem ATR-Dokument gleich
 * stehen, und die Gerüstdatei, aus der die Ausgabe entsteht.
 *
 * Angelegt werden Vorlagen beim Einlesen einer Referenzmappe — das Programm
 * steht dort in Zelle D2. Hier werden sie gepflegt, wie im Altsystem
 * (`AtrTemplatePage`) mit einem „Speichern“ je Vorlage statt beim Verlassen
 * jedes Feldes.
 */
const FELDER: { feld: keyof Vorlage; wort: keyof Texte["atrEinstellungen"] }[] = [
  { feld: "kunde", wort: "kunde" },
  { feld: "lieferant", wort: "lieferant" },
  { feld: "arbeitspaket", wort: "arbeitspaket" },
  { feld: "referenz", wort: "referenz" },
  { feld: "besteller_spez", wort: "bestellerSpez" },
  { feld: "lieferanten_spez", wort: "lieferantenSpez" },
  { feld: "kunden_spez", wort: "kundenSpez" },
  { feld: "atp", wort: "atp" },
  { feld: "nscm", wort: "nscm" },
  { feld: "ata_kapitel", wort: "ataKapitel" },
  { feld: "waage", wort: "waage" },
  { feld: "qs_unterschrift", wort: "qsUnterschrift" },
];

export function AtrVorlagen() {
  const worte = useTexte();
  const vorlagen = useQuery({
    queryKey: atrKeys.vorlagen(),
    queryFn: atrApi.vorlagen,
  });
  const liste = vorlagen.data ?? [];

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 font-medium">
        {worte.atrEinstellungen.vorlagen}
        <Hinweis text={worte.atrEinstellungen.vorlagenHinweis} />
      </h3>

      {liste.length === 0 ? (
        <EmptyState
          title={worte.atrEinstellungen.keineVorlage}
          body={worte.atrEinstellungen.keineVorlageText}
        />
      ) : (
        liste.map((v) => <VorlageKarte key={`${v.programm}-${v.geaendert_am}`} vorlage={v} />)
      )}
    </div>
  );
}

function VorlageKarte({ vorlage: v }: { vorlage: Vorlage }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const anfang: Record<string, string> = Object.fromEntries(
    FELDER.map(({ feld }) => [feld, ((v[feld] as string | null) ?? "").trim()]),
  );
  const [entwurf, setEntwurf] = useState(anfang);
  const geaendert = FELDER.filter(({ feld }) => entwurf[feld].trim() !== anfang[feld]);

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: atrKeys.vorlagen() });

  const speichern = useMutation({
    mutationFn: () =>
      atrApi.vorlageAendern(
        v.programm,
        Object.fromEntries(geaendert.map(({ feld }) => [feld, entwurf[feld].trim() || null])),
      ),
    onSuccess: () => {
      toast.success(worte.atrEinstellungen.gespeichert);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const geruest = useMutation({
    mutationFn: (datei: File) => atrApi.geruestSetzen(v, datei),
    onSuccess: () => {
      toast.success(worte.atrEinstellungen.geruestHinterlegt);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-medium">{v.programm}</h4>
        <label
          className={
            "ms-auto inline-flex h-8 cursor-pointer items-center rounded-md " +
            "border border-[var(--border)] px-3 text-xs font-medium " +
            "hover:bg-[var(--muted)] focus-within:outline-2 focus-within:outline-[var(--ring)]"
          }
        >
          <FileUp className="me-1.5 h-3.5 w-3.5" aria-hidden />
          {v.geruest_dateiname ? worte.atrEinstellungen.geruestErsetzen : worte.atrEinstellungen.geruestWaehlen}
          <input
            type="file"
            accept={`.xlsx,${XLSX_TYP}`}
            className="sr-only"
            aria-label={`Gerüstdatei für ${v.programm}`}
            onChange={(e) => {
              const datei = e.target.files?.[0];
              e.target.value = "";
              if (datei) geruest.mutate(datei);
            }}
          />
        </label>
      </div>

      <p className="text-sm text-[var(--fg-muted)]">
        Gerüstdatei:{" "}
        {v.geruest_dateiname ? (
          <span className="text-[var(--fg)]">{v.geruest_dateiname}</span>
        ) : (
          worte.atrEinstellungen.keineHinterlegt
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FELDER.map(({ feld, wort }) => (
          <div key={feld} className="flex flex-col gap-1">
            <Label htmlFor={`${v.programm}-${feld}`}>
              {worte.atrEinstellungen[wort] as string}
            </Label>
            <Input
              id={`${v.programm}-${feld}`}
              value={entwurf[feld]}
              placeholder="—"
              onChange={(e) => setEntwurf((alt) => ({ ...alt, [feld]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => speichern.mutate()}
          disabled={geaendert.length === 0 || speichern.isPending}
        >
          {worte.atrEinstellungen.speichern}
        </Button>
      </div>
    </Card>
  );
}
