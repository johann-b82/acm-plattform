"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Download, FileCog, Undo2 } from "lucide-react";

import {
  lieferungApi,
  lieferungKeys,
  type AtrPosition,
  type Lieferung,
} from "@/lib/atr";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";
import type { Texte } from "@/texte";

/**
 * Durchsicht einer Lieferung: Kopfdaten ergänzen, Positionen prüfen,
 * freigeben.
 *
 * Nach der Freigabe sind die Positionen fest — das hält ein Trigger an der
 * Tabelle, nicht diese Seite. Hier werden die Felder nur ausgegraut, damit
 * niemand gegen eine Wand tippt.
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

const KOPFFELDER: { feld: keyof Lieferung; wort: keyof Texte["durchsicht"]; typ?: string }[] = [
  { feld: "atr_nummer", wort: "atrNummer" },
  { feld: "containernummer", wort: "containernummer" },
  { feld: "satz_titel", wort: "satzTitel" },
  { feld: "programm", wort: "programm" },
  { feld: "msn", wort: "msn" },
  { feld: "bereich", wort: "bereich" },
  { feld: "wiegedatum", wort: "wiegedatum", typ: "date" },
  { feld: "pruefdatum", wort: "pruefdatum", typ: "date" },
  { feld: "qs_unterschrift", wort: "qsUnterschrift" },
  { feld: "max_gewicht_kg", wort: "hoechstgewicht" },
];

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
  const zeilen = positionen.data ?? [];
  const offen = l?.status === "entwurf";
  const bearbeitbar = darfSchreiben && offen;

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["atr"] });

  const aendern = useMutation({
    mutationFn: (felder: Partial<Lieferung>) => lieferungApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

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

  const status = useMutation({
    mutationFn: (neu: Lieferung["status"]) => lieferungApi.aendern(id, { status: neu }),
    onSuccess: (_, neu) => {
      toast.success(neu === "freigegeben" ? "Freigegeben." : "Freigabe zurückgenommen.");
      return neuLaden();
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/atr/lieferungen"
          className="inline-flex items-center text-sm text-[var(--fg-muted)] underline-offset-4 hover:underline"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
          Lieferungen
        </Link>
        <h1 className="text-lg font-semibold">
          Lieferschein {l.lieferschein_nr ?? l.quelle_dateiname}
        </h1>
        {offen ? (
          <Badge variant="outline">{worte.lieferungen.entwurf}</Badge>
        ) : (
          <Badge>{worte.lieferungen.freigegeben}</Badge>
        )}
        {darfSchreiben && (
          <div className="ml-auto">
            {offen ? (
              <Button onClick={() => status.mutate("freigegeben")}>
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
                {worte.durchsicht.freigeben}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => status.mutate("entwurf")}>
                <Undo2 className="mr-2 h-4 w-4" aria-hidden />
                {worte.durchsicht.zuruecknehmen}
              </Button>
            )}
          </div>
        )}
      </div>

      {l.programm_grund && (
        <p className="text-sm text-[var(--fg-muted)]">{l.programm_grund}</p>
      )}

      <Card className="flex flex-wrap items-center gap-2 p-4">
        {darfSchreiben && (
          <Button
            variant="outline"
            onClick={() => erzeugen.mutate()}
            disabled={erzeugen.isPending || zeilen.length === 0}
          >
            <FileCog className="mr-2 h-4 w-4" aria-hidden />
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
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {name}
            </Button>
          );
        })}

        <span className="ml-auto text-xs text-[var(--fg-muted)]">
          {!l.erzeugt_am
            ? "Noch nichts erzeugt."
            : new Date(l.erzeugt_am) < new Date(l.geaendert_am)
              ? `Erzeugt am ${ZEIT.format(new Date(l.erzeugt_am))} — die Lieferung wurde danach geändert.`
              : `Erzeugt am ${ZEIT.format(new Date(l.erzeugt_am))}.`}
        </span>
      </Card>

      {l.hinweise.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-medium">Beim Einlesen aufgefallen</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-[var(--fg-muted)]">
            {l.hinweise.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-medium">{worte.durchsicht.kopfdaten}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {KOPFFELDER.map(({ feld, wort, typ }) => (
            <div key={feld} className="flex flex-col gap-1">
              <Label htmlFor={feld}>{worte.durchsicht[wort] as string}</Label>
              <Input
                id={feld}
                type={typ}
                defaultValue={(l[feld] as string | null) ?? ""}
                placeholder="—"
                disabled={!darfSchreiben}
                onBlur={(e) => {
                  const wert = e.target.value.trim() || null;
                  if (wert !== ((l[feld] as string | null) ?? null)) {
                    aendern.mutate({ [feld]: wert } as Partial<Lieferung>);
                  }
                }}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-medium">{worte.durchsicht.positionen}</h2>
          <span className="text-sm text-[var(--fg-muted)]">
            {zeilen.length} Zeilen · {gesamtgewicht.toFixed(3).replace(".", ",")} kg
            {ohneKatalog > 0 && ` · ${ohneKatalog} nicht im Katalog`}
            {ohneGewicht > 0 && ` · ${ohneGewicht} ohne Gewicht`}
          </span>
        </div>

        <TableWrap className="mt-3">
          <Table>
            <thead>
              <tr>
                <Th className="w-14">{worte.durchsicht.pos}</Th>
                <Th>{worte.atr.teilenummer}</Th>
                <Th>{worte.atr.bezeichnung}</Th>
                <Th>{worte.atr.zeichnung}</Th>
                <Th className="w-16">{worte.durchsicht.menge}</Th>
                <Th className="w-28">{worte.atr.gewicht}</Th>
                <Th>{worte.durchsicht.seriennummern}</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {zeilen.map((p) => (
                <tr key={p.id} className={p.teil_id ? undefined : "bg-[var(--muted)]"}>
                  <Td className="tabular-nums">{p.pos ?? "—"}</Td>
                  <Td>
                    <span className="font-medium">{p.teilenummer ?? "—"}</span>
                    {!p.teil_id && (
                      <span className="mt-0.5 block text-xs text-[var(--fg-muted)]">
                        {worte.durchsicht.nichtImKatalog}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Input
                      defaultValue={p.bezeichnung ?? ""}
                      aria-label={`Bezeichnung Position ${p.pos ?? p.reihenfolge}`}
                      placeholder="—"
                      disabled={!bearbeitbar}
                      onBlur={(e) => {
                        const wert = e.target.value.trim() || null;
                        if (wert !== p.bezeichnung) {
                          positionAendern.mutate({
                            pid: p.id,
                            felder: { bezeichnung: wert },
                          });
                        }
                      }}
                    />
                  </Td>
                  <Td>
                    <Input
                      className="w-40"
                      defaultValue={p.zeichnung ?? ""}
                      aria-label={`Zeichnung Position ${p.pos ?? p.reihenfolge}`}
                      placeholder="—"
                      disabled={!bearbeitbar}
                      onBlur={(e) => {
                        const wert = e.target.value.trim() || null;
                        if (wert !== p.zeichnung) {
                          positionAendern.mutate({
                            pid: p.id,
                            felder: { zeichnung: wert },
                          });
                        }
                      }}
                    />
                  </Td>
                  <Td className="tabular-nums">{p.menge}</Td>
                  <Td>
                    <Input
                      className="w-24"
                      defaultValue={p.gewicht_kg ?? ""}
                      aria-label={`Gewicht Position ${p.pos ?? p.reihenfolge}`}
                      placeholder="—"
                      disabled={!bearbeitbar}
                      onBlur={(e) => {
                        const wert = e.target.value.trim() || null;
                        if (wert !== p.gewicht_kg) {
                          positionAendern.mutate({
                            pid: p.id,
                            felder: { gewicht_kg: wert },
                          });
                        }
                      }}
                    />
                  </Td>
                  <Td className="text-xs">
                    {p.seriennummern.length ? p.seriennummern.join(", ") : "—"}
                  </Td>
                  <Td className="text-right">
                    {bearbeitbar && (
                      <ConfirmDeleteButton
                        itemLabel={`Position ${p.pos ?? p.reihenfolge}`}
                        onConfirm={() =>
                          positionLoeschen.mutateAsync(p.id).then(() => undefined)
                        }
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>

        {!offen && (
          <p className="mt-3 text-xs text-[var(--fg-muted)]">
            {worte.durchsicht.festHinweis}
          </p>
        )}
      </Card>
    </div>
  );
}
