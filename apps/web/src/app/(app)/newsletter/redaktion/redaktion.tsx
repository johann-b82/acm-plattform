"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Snowflake } from "lucide-react";

import {
  newsletterApi,
  newsletterKeys,
  type Ausgabe,
  type Kapitel,
  type KapitelArt,
} from "@/lib/newsletter";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";
import { useKapitelart } from "@/lib/tafeln";

/**
 * Die Redaktion: Ausgaben anlegen, Kapitel ordnen, Einträge und Bilder
 * pflegen, veröffentlichen.
 *
 * Kapitel sind Zeilen mit Titel, Art und Sortierung — was im Altprojekt eine
 * Konstante im Code war plus zwei JSONB-Spalten, die sie überschrieben.
 * „Hoch" und „Runter" tauschen zwei Sortierwerte; ein Ziehen-und-Fallenlassen
 * wäre hübscher, aber die Liste ist kurz.
 */
export function Redaktion({
  darfKpi,
  darfHr,
}: {
  darfKpi: boolean;
  darfHr: boolean;
}) {
  const worte = useTexte();
  const kapitelart = useKapitelart();
  const queryClient = useQueryClient();
  const jetzt = new Date();
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [neuJahr, setNeuJahr] = useState(String(jetzt.getFullYear()));
  const [neuQuartal, setNeuQuartal] = useState(
    String(Math.floor(jetzt.getMonth() / 3) + 1),
  );
  const [neuesKapitel, setNeuesKapitel] = useState("");
  const [neueArt, setNeueArt] = useState<KapitelArt>("eintraege");

  const ausgaben = useQuery({
    queryKey: newsletterKeys.ausgaben(),
    queryFn: newsletterApi.ausgaben,
  });
  const liste = useMemo(() => ausgaben.data ?? [], [ausgaben.data]);
  const aktiv: Ausgabe | undefined = liste.find((a) => a.id === gewaehlt) ?? liste[0];

  const kapitel = useQuery({
    queryKey: newsletterKeys.kapitel(aktiv?.id ?? ""),
    queryFn: () => newsletterApi.kapitel(aktiv!.id),
    enabled: !!aktiv,
  });
  const kapitelListe = kapitel.data ?? [];

  const neuLaden = async () => {
    await queryClient.invalidateQueries({ queryKey: newsletterKeys.ausgaben() });
    if (aktiv) {
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.kapitel(aktiv.id) });
    }
  };

  /** Ein Muster für alle Schreibwege: neu laden und Fehler zeigen.
   *
   *  Heißt `use…`, weil es einen Hook ruft — jeder Aufruf unten ist damit
   *  einer, und die Reihenfolge muss über alle Rendervorgänge gleich bleiben.
   *  Genau darauf achtet `react-hooks/rules-of-hooks`, und das kann sie nur,
   *  wenn der Name es sagt. */
  function useSchreiben<T>(fn: (wert: T) => Promise<unknown>, erfolg?: string) {
    return useMutationMitToast(fn, neuLaden, erfolg);
  }

  const ausgabeAnlegen = useSchreiben(
    () => newsletterApi.ausgabeAnlegen(Number(neuJahr), Number(neuQuartal)),
    worte.newsletter.ausgabeAngelegt,
  );
  const ausgabeAendern = useSchreiben((f: Partial<Ausgabe>) =>
    newsletterApi.ausgabeAendern(aktiv!.id, f),
  );
  const ausgabeLoeschen = useSchreiben(
    () => newsletterApi.ausgabeLoeschen(aktiv!.id),
    worte.newsletter.ausgabeGeloescht,
  );
  const kapitelAnlegen = useSchreiben(() => {
    const hoechste = kapitelListe.reduce((m, k) => Math.max(m, k.sortierung), -1);
    return newsletterApi.kapitelAnlegen(
      aktiv!.id,
      neuesKapitel.trim(),
      neueArt,
      hoechste + 1,
    );
  }, worte.newsletter.kapitelAngelegt);
  const kapitelAendern = useSchreiben(
    ({ id, felder }: { id: string; felder: Partial<Kapitel> }) =>
      newsletterApi.kapitelAendern(id, felder),
  );
  const kapitelLoeschen = useSchreiben((k: Kapitel) => newsletterApi.kapitelLoeschen(k));
  const einfrieren = useSchreiben(
    (k: Kapitel) => newsletterApi.einfrieren(k),
    worte.newsletter.standEingefroren,
  );
  const eintragAnlegen = useSchreiben((k: Kapitel) =>
    newsletterApi.eintragAnlegen(
      k.id,
      k.newsletter_eintrag.reduce((m, e) => Math.max(m, e.sortierung), -1) + 1,
    ),
  );
  const eintragAendern = useSchreiben(
    ({ id, felder }: { id: string; felder: { untertitel?: string; inhalt_md?: string } }) =>
      newsletterApi.eintragAendern(id, felder),
  );
  const eintragLoeschen = useSchreiben(newsletterApi.eintragLoeschen);
  const bildLoeschen = useSchreiben(newsletterApi.bildLoeschen);
  const bildAendern = useSchreiben(
    ({ id, felder }: { id: string; felder: { spalten?: number; zeilen?: number } }) =>
      newsletterApi.bildAendern(id, felder),
  );

  const deckblatt = useSchreiben(
    ({ feld, datei }: { feld: "titelbild" | "rueckseite"; datei: File }) =>
      newsletterApi.deckblattSetzen(aktiv!, feld, datei),
  );
  const bildHinzufuegen = useSchreiben(
    ({ id, datei, nr }: { id: string; datei: File; nr: number }) =>
      newsletterApi.bildHinzufuegen(id, datei, nr),
  );

  /** Tauscht die Sortierung mit dem Nachbarn. */
  const verschieben = (index: number, richtung: -1 | 1) => {
    const a = kapitelListe[index];
    const b = kapitelListe[index + richtung];
    if (!a || !b) return;
    kapitelAendern.mutate({ id: a.id, felder: { sortierung: b.sortierung } });
    kapitelAendern.mutate({ id: b.id, felder: { sortierung: a.sortierung } });
  };

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.newsletter.redaktionEinleitung}
        unter={
          <div className="mt-2 flex justify-center text-sm">
            <Link href="/newsletter" className="underline-offset-4 hover:underline">
              {worte.newsletter.zurLeseransicht}
            </Link>
          </div>
        }
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="jahr">{worte.newsletter.jahr}</Label>
          <Input
            id="jahr"
            className="w-24"
            value={neuJahr}
            onChange={(e) => setNeuJahr(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="quartal">{worte.newsletter.quartal}</Label>
          <Select
            id="quartal"
            className="w-20"
            value={neuQuartal}
            onChange={(e) => setNeuQuartal(e.target.value)}
          >
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={() => ausgabeAnlegen.mutate(undefined as never)}>
          <Plus className="me-2 h-4 w-4" aria-hidden />
          {worte.newsletter.ausgabeAnlegen}
        </Button>
        {liste.length > 0 && (
          <Select
            aria-label={worte.newsletter.ausgabeBearbeiten}
            className="ms-auto w-56"
            value={aktiv?.id ?? ""}
            onChange={(e) => setGewaehlt(e.target.value)}
          >
            {liste.map((a) => (
              <option key={a.id} value={a.id}>
                {worte.newsletter.quartalKurz(a.quartal, a.jahr)} ·{" "}
                {a.status === "entwurf" ? worte.newsletter.entwurf : worte.newsletter.veroeffentlicht}
              </option>
            ))}
          </Select>
        )}
      </Card>

      {!aktiv ? (
        <EmptyState
          title={worte.newsletter.keineAusgabe}
          body={worte.newsletter.keineAusgabeRedaktion}
        />
      ) : (
        <>
          <Card className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <div className="flex flex-col gap-1">
                <Label htmlFor="titel">{worte.newsletter.titelDerAusgabe}</Label>
                <Input
                  id="titel"
                  defaultValue={aktiv.titel ?? ""}
                  placeholder={worte.newsletter.quartalJahr(aktiv.quartal, aktiv.jahr)}
                  onBlur={(e) => {
                    if (e.target.value !== (aktiv.titel ?? "")) {
                      ausgabeAendern.mutate({ titel: e.target.value || null });
                    }
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="status">{worte.newsletter.status}</Label>
                <Select
                  id="status"
                  value={aktiv.status}
                  onChange={(e) =>
                    ausgabeAendern.mutate({ status: e.target.value as Ausgabe["status"] })
                  }
                >
                  <option value="entwurf">{worte.newsletter.entwurf}</option>
                  <option value="veroeffentlicht">{worte.newsletter.veroeffentlicht}</option>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(["titelbild", "rueckseite"] as const).map((feld) => (
                <BildKnopf
                  key={feld}
                  beschriftung={`${feld === "titelbild" ? worte.newsletter.titelbild : worte.newsletter.rueckseite}${
                    aktiv[feld] ? " ersetzen" : " wählen"
                  }`}
                  onDatei={(datei) => deckblatt.mutate({ feld, datei })}
                />
              ))}
              <div className="ms-auto">
                <ConfirmDeleteButton
                  itemLabel={worte.newsletter.ausgabeLoeschen(aktiv.quartal, aktiv.jahr)}
                  onConfirm={() =>
                    ausgabeLoeschen.mutateAsync(undefined as never).then(() => undefined)
                  }
                />
              </div>
            </div>
          </Card>

          <Card className="flex flex-wrap items-end gap-3 p-4">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="kapitelTitel">{worte.newsletter.neuesKapitel}</Label>
              <Input
                id="kapitelTitel"
                value={neuesKapitel}
                placeholder={worte.newsletter.kapitelBeispiel}
                onChange={(e) => setNeuesKapitel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kapitelArt">{worte.newsletter.art}</Label>
              <Select
                id="kapitelArt"
                className="w-56"
                value={neueArt}
                onChange={(e) => setNeueArt(e.target.value as KapitelArt)}
              >
                {(Object.keys(kapitelart) as KapitelArt[]).map((a) => (
                  <option key={a} value={a}>
                    {kapitelart[a]}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              disabled={!neuesKapitel.trim()}
              onClick={() => {
                kapitelAnlegen.mutate(undefined as never);
                setNeuesKapitel("");
              }}
            >
              {worte.newsletter.hinzufuegen}
            </Button>
          </Card>

          {kapitelListe.map((k, i) => (
            <Card key={k.id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  defaultValue={k.titel}
                  aria-label={worte.newsletter.kapiteltitel}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== k.titel) {
                      kapitelAendern.mutate({
                        id: k.id,
                        felder: { titel: e.target.value.trim() },
                      });
                    }
                  }}
                />
                <span className="text-xs text-[var(--fg-muted)]">{kapitelart[k.art]}</span>
                <div className="ms-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={worte.newsletter.kapitelHoch}
                    disabled={i === 0}
                    onClick={() => verschieben(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={worte.newsletter.kapitelRunter}
                    disabled={i === kapitelListe.length - 1}
                    onClick={() => verschieben(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <ConfirmDeleteButton
                    itemLabel={`Kapitel „${k.titel}“`}
                    onConfirm={() => kapitelLoeschen.mutateAsync(k).then(() => undefined)}
                  />
                </div>
              </div>

              {k.art === "eintraege" ? (
                <>
                  {k.newsletter_eintrag.map((e) => (
                    <div
                      key={e.id}
                      className="space-y-2 rounded-md border border-[var(--border)] p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          defaultValue={e.untertitel}
                          placeholder={worte.newsletter.ueberschrift}
                          aria-label={worte.newsletter.ueberschrift}
                          onBlur={(ev) => {
                            if (ev.target.value !== e.untertitel) {
                              eintragAendern.mutate({
                                id: e.id,
                                felder: { untertitel: ev.target.value },
                              });
                            }
                          }}
                        />
                        <ConfirmDeleteButton
                          itemLabel={worte.newsletter.eintrag}
                          onConfirm={() =>
                            eintragLoeschen.mutateAsync(e).then(() => undefined)
                          }
                        />
                      </div>
                      <Textarea
                        rows={5}
                        defaultValue={e.inhalt_md}
                        placeholder={worte.newsletter.textMarkdown}
                        aria-label={worte.newsletter.text}
                        onBlur={(ev) => {
                          if (ev.target.value !== e.inhalt_md) {
                            eintragAendern.mutate({
                              id: e.id,
                              felder: { inhalt_md: ev.target.value },
                            });
                          }
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <BildKnopf
                          beschriftung={worte.newsletter.bild}
                          onDatei={(datei) =>
                            bildHinzufuegen.mutate({
                              id: e.id,
                              datei,
                              nr: e.newsletter_bild.length,
                            })
                          }
                        />
                        {e.newsletter_bild.map((b, nr) => (
                          <span
                            key={b.id}
                            className="flex items-center gap-1 rounded-md bg-[var(--muted)] px-2 py-1 text-xs"
                          >
                            Bild {nr + 1}
                            <Select
                              aria-label={worte.newsletter.bildGroesse(nr + 1)}
                              className="h-6 w-24 text-xs"
                              value={`${b.spalten}x${b.zeilen}`}
                              onChange={(ev) => {
                                const [sp, ze] = ev.target.value.split("x").map(Number);
                                bildAendern.mutate({
                                  id: b.id,
                                  felder: { spalten: sp, zeilen: ze },
                                });
                              }}
                            >
                              {["1x1", "2x1", "2x2", "3x1", "4x1", "4x2"].map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </Select>
                            <ConfirmDeleteButton
                              itemLabel={`Bild ${nr + 1}`}
                              onConfirm={() =>
                                bildLoeschen.mutateAsync(b).then(() => undefined)
                              }
                            />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => eintragAnlegen.mutate(k)}>
                    <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
                    {worte.newsletter.eintrag}
                  </Button>
                </>
              ) : (
                <EingefrorenerStand
                  kapitel={k}
                  darf={k.art === "kpi" ? darfKpi : darfHr}
                  onEinfrieren={() => einfrieren.mutate(k)}
                />
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

/** Ein Knopf, der eine Datei entgegennimmt.
 *
 *  Der Eingang steckt im Label statt in einem geteilten, versteckten Feld, das
 *  per `.click()` ausgeloest und ueber einen Zustand dem richtigen Ziel
 *  zugeordnet wird. Der Browser verbindet Label und Eingang von sich aus; das
 *  spart den Zustand und die Frage, welches Ziel gerade gemeint war. */
function BildKnopf({
  beschriftung,
  onDatei,
}: {
  beschriftung: string;
  onDatei: (datei: File) => void;
}) {
  return (
    <label
      className={
        "inline-flex h-8 cursor-pointer items-center rounded-md border border-[var(--border)] " +
        "px-3 text-xs font-medium hover:bg-[var(--muted)] focus-within:outline-2 " +
        "focus-within:outline-[var(--ring)]"
      }
    >
      <ImagePlus className="me-1.5 h-3.5 w-3.5" aria-hidden />
      {beschriftung}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        aria-label={beschriftung}
        onChange={(e) => {
          const datei = e.target.files?.[0];
          e.target.value = "";
          if (datei) onDatei(datei);
        }}
      />
    </label>
  );
}

/** Ein KPI- oder Neuzugangs-Kapitel zeigt keinen Text, sondern einen Stand:
 *  was aus dem Personalbestand eingefroren wurde. */
function EingefrorenerStand({
  kapitel,
  darf,
  onEinfrieren,
}: {
  kapitel: Kapitel;
  darf: boolean;
  onEinfrieren: () => void;
}) {
  const worte = useTexte();
  // `null` heisst nie eingefroren; eine leere Liste heisst eingefroren, und im
  // Quartal kam niemand dazu. Beides gleich zu behandeln hiesse, die Redaktion
  // klickte weiter auf „Einfrieren" und fragte sich, warum nichts passiert.
  const nieEingefroren = kapitel.stand === null || kapitel.stand === undefined;
  const anzahl = Array.isArray(kapitel.stand) ? kapitel.stand.length : null;

  let stand: string;
  if (nieEingefroren) {
    stand = worte.newsletter.nieEingefroren;
  } else if (kapitel.art === "kpi") {
    stand = worte.newsletter.kpiEingefroren;
  } else if (anzahl === 0) {
    stand = worte.newsletter.niemandEingefroren;
  } else {
    stand = worte.newsletter.zugaengeEingefroren(anzahl ?? 0);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--fg-muted)]">{stand}</p>
      <Button variant="outline" size="sm" onClick={onEinfrieren} disabled={!darf}>
        <Snowflake className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {nieEingefroren ? worte.newsletter.einfrieren : worte.newsletter.neuEinfrieren}
      </Button>
      {!darf && (
        <p className="text-xs text-[var(--fg-muted)]">
          {worte.newsletter.rechtFehlt(
            kapitel.art === "kpi" ? worte.newsletter.quelleKpi : worte.newsletter.quellePersonal,
          )}
        </p>
      )}
    </div>
  );
}

/** Schreibweg mit einheitlicher Behandlung: neu laden, Fehler als Hinweis. */
function useMutationMitToast<T>(
  fn: (wert: T) => Promise<unknown>,
  danach: () => Promise<void>,
  erfolg?: string,
) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (erfolg) toast.success(erfolg);
      return danach();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });
}
