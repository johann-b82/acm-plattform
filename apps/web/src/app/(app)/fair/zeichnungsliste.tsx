"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import {
  ERLAUBTE_TYPEN,
  fairApi,
  fairKeys,
  type Zeichnung,
} from "@/lib/fair";
import { gruppiereNachKunde, kundenAuswahl, nachKunde, OHNE_KUNDE } from "@/lib/fair/kunden";
import { EmptyState, Input, Label, Select } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Klappbar } from "../hr/klappbar";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenwerkzeuge, useInSchale, Werkzeug } from "@/components/sidebar/werkzeugplatz";



/**
 * Die Zeichnungen einer Erstmusterprüfung. Hochladen, öffnen, löschen.
 */
export function Zeichnungsliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const zeichnungen = useQuery({
    queryKey: fairKeys.zeichnungen(),
    queryFn: fairApi.zeichnungen,
  });
  const liste = useMemo(() => zeichnungen.data ?? [], [zeichnungen.data]);
  const [kunde, setKunde] = useState("");
  const auswahl = useMemo(() => kundenAuswahl(liste), [liste]);
  const gefiltert = useMemo(() => nachKunde(liste, kunde), [liste, kunde]);
  const gruppen = useMemo(() => gruppiereNachKunde(gefiltert), [gefiltert]);

  const neuLaden = () =>
    queryClient.invalidateQueries({ queryKey: fairKeys.zeichnungen() });

  const hochladen = useMutation({
    mutationFn: (datei: File) => fairApi.hochladen(datei, name),
    onSuccess: () => {
      setName("");
      toast.success("Zeichnung hochgeladen.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (z: Zeichnung) => fairApi.zeichnungLoeschen(z),
    onSuccess: () => {
      toast.success("Zeichnung gelöscht.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <div className="space-y-6">

      {/* Hochladen und Kundenfilter gelten für die ganze Liste: in der Schale
          stehen sie in der rechten Leiste. */}
      {darfSchreiben && (
        <Seitenwerkzeuge kategorie="aktionen">
        <div className="flex flex-col items-stretch gap-2">
          {/* In der Leiste trägt der Werkzeugtitel die Beschriftung. */}
          <Werkzeug titel={worte.fair.bezeichnungFrei}>
            <div className="flex flex-col gap-1">
              {!inSchale && <Label htmlFor="name">{worte.fair.bezeichnungFrei}</Label>}
              <Input
                id="name"
                aria-label={worte.fair.bezeichnungFrei}
                value={name}
                placeholder={worte.fair.beispiel}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </Werkzeug>
          <label
            className={
              "inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-[var(--fg)] px-4 " +
              "text-sm font-medium text-[var(--bg)] hover:opacity-90 " +
              "focus-within:outline-2 focus-within:outline-[var(--ring)]"
            }
          >
            <FileUp className="me-2 h-4 w-4" aria-hidden />
            {hochladen.isPending ? worte.fair.wirdGeladen : worte.fair.zeichnungWaehlen}
            <input
              type="file"
              accept={ERLAUBTE_TYPEN.join(",")}
              className="sr-only"
              aria-label={worte.fair.zeichnungWaehlen}
              disabled={hochladen.isPending}
              onChange={(e) => {
                const datei = e.target.files?.[0];
                e.target.value = "";
                if (datei) hochladen.mutate(datei);
              }}
            />
          </label>
        </div>
        </Seitenwerkzeuge>
      )}

      {liste.length > 0 && (
        <Seitenwerkzeuge kategorie="filter">
          <Werkzeug titel={worte.fair.kunde}>
            <Select
              aria-label={worte.fair.kundenfilter}
              value={kunde}
              onChange={(e) => setKunde(e.target.value)}
            >
              <option value="">{worte.fair.alleKunden}</option>
              {auswahl.kunden.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              {auswahl.ohneKunde && <option value={OHNE_KUNDE}>{worte.fair.ohneKunde}</option>}
            </Select>
          </Werkzeug>
        </Seitenwerkzeuge>
      )}

      {zeichnungen.isLoading && (
        <p className="text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</p>
      )}

      {!zeichnungen.isLoading && liste.length === 0 && (
        <EmptyState
          title={worte.fair.keineZeichnung}
          body={
            darfSchreiben ? worte.fair.keineZeichnungSchreiben : worte.fair.keineZeichnungLesen
          }
        />
      )}

      {liste.length > 0 && (
        <div className="space-y-4">
          {/* Jeder Kundenblock ist einzeln auf- und zuklappbar, wie im Altsystem.
              Die Klappkomponente trägt Rahmen, Überschrift und Anzahl und hält
              den Inhalt versteckt statt abgebaut. */}
          {gruppen.map((gruppe) => (
            <Klappbar
              key={gruppe.kunde ?? "__ohne"}
              titel={gruppe.kunde ?? worte.fair.ohneKunde}
              anzahl={gruppe.zeichnungen.length}
              ebene="h3"
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium">
                        {worte.fair.bezeichnung}
                      </th>
                      <th className="border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium">
                        {worte.fair.teilenummer}
                      </th>
                      <th className="border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium">
                        {worte.fair.hochgeladen}
                      </th>
                      {darfSchreiben && <th className="border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {gruppe.zeichnungen.map((z) => (
                      <tr key={z.id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2">
                          <Link href={`/fair/${z.id}`} className="font-medium underline-offset-4 hover:underline">
                            {z.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {z.teilenummer?.trim() || (
                            // Fachliche Validierung: eine FAIR-Zeichnung braucht eine
                            // Teilenummer. Fehlt sie, fällt der Eintrag auf — zu prüfen
                            // oder als Nicht-Zeichnung auszusortieren.
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs text-[var(--warn)]"
                              style={{ background: "color-mix(in oklab, var(--warn) 18%, transparent)" }}
                              title={worte.fair.zuPruefenHinweis}
                            >
                              {worte.fair.zuPruefen}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--fg-muted)]">
                          {DATUM.format(new Date(z.erstellt_am))}
                        </td>
                        {darfSchreiben && (
                          <td className="px-3 py-2 text-end">
                            <ConfirmDeleteButton
                              itemLabel={z.name}
                              onConfirm={() => loeschen.mutateAsync(z).then(() => undefined)}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Klappbar>
          ))}
        </div>
      )}
    </div>
  );
}
