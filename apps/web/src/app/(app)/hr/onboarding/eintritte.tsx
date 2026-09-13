"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileDown, Plus } from "lucide-react";

import {
  istNeu,
  onboardingApi,
  onboardingKeys,
  personenwahl,
  type Eintritt,
  type Personenwahl,
  type Planzeile,
} from "@/lib/onboarding";
import { Badge, Button, Input, Label } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Segmentwahl } from "../segmentwahl";

const LEER = { name: "", abteilung: "", position: "", eintritt: "" };

/**
 * Die Eintritte und ihr Schulungsplan.
 *
 * Der Plan kommt aus der Datenbank: `schulungsplan(employee_id)` verbindet
 * Anforderungsmatrix, Rollenzuordnung und Bestand. Fehlt die Zuordnung
 * Position → Abteilungskürzel, meldet die Funktion das als eigene Zeile —
 * ohne diesen Hinweis entstünden unbemerkt zu wenige Pflichtschulungen.
 *
 * Die Personenwahl (ONB-03) wirkt auf die ganze Liste, bevor Suche,
 * Sortierung und Seiten greifen.
 */
export function Eintritte({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState<number | null>(null);
  const [neu, setNeu] = useState({ ...LEER });
  const [wahl, setWahl] = useState<Personenwahl>("neu");

  const eintritte = useQuery({ queryKey: onboardingKeys.eintritte(), queryFn: onboardingApi.eintritte });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const abteilung = useMutation({
    mutationFn: (w: { employee_id: number; abteilung: string | null }) =>
      onboardingApi.abteilungSetzen(w.employee_id, w.abteilung),
    onSuccess: neuLaden,
    onError: melde,
  });

  const paket = useMutation({
    mutationFn: (e: Eintritt) => onboardingApi.paketVermerken(e),
    onSuccess: () => {
      toast.success("Übergabe vermerkt.");
      return neuLaden();
    },
    onError: melde,
  });

  // Das Paket zu erzeugen **ist** die Übergabe: die Route vermerkt sie selbst.
  // Deshalb danach neu laden — die „neu"-Markierung verschwindet dabei.
  const paketDrucken = useMutation({
    mutationFn: (e: Eintritt) => onboardingApi.paket(e),
    onSuccess: neuLaden,
    onError: melde,
  });

  const uebersichtDrucken = useMutation({
    mutationFn: (e: Eintritt) => onboardingApi.uebersicht(e),
    onError: melde,
  });

  const externAnlegen = useMutation({
    mutationFn: () =>
      onboardingApi.externAnlegen({
        name: neu.name.trim(),
        abteilung: neu.abteilung.trim() || null,
        position: neu.position.trim() || null,
        eintritt: neu.eintritt || null,
      }),
    onSuccess: () => {
      setNeu({ ...LEER });
      return neuLaden();
    },
    onError: melde,
  });

  const externWeg = useMutation({
    mutationFn: (id: string) => onboardingApi.externLoeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const alle = eintritte.data;
  const liste = useMemo(() => personenwahl(alle ?? [], wahl), [alle, wahl]);
  const anzahl = (w: Personenwahl) => (alle ? personenwahl(alle, w).length : undefined);

  const spalten: Tabellenspalte<Eintritt>[] = [
    {
      schluessel: "name",
      titel: worte.onboarding.person,
      typ: "text",
      wert: (e) => e.name,
      zelle: (e) => (
        <>
          {e.name}
          {e.extern_id && (
            <Badge variant="outline" className="ms-2">
              {worte.onboarding.nichtInPersonio}
            </Badge>
          )}
          {istNeu(e) && <Badge className="ms-2">neu</Badge>}
        </>
      ),
    },
    {
      schluessel: "abteilung",
      titel: worte.onboarding.abteilung,
      typ: "text",
      wert: (e) => e.abteilung,
      zelle: (e) =>
        e.employee_id !== null ? (
          <Input
            defaultValue={e.abteilung ?? ""}
            placeholder="—"
            aria-label={worte.onboarding.abteilung}
            disabled={!darfSchreiben}
            title={e.abteilung_gesetzt ? worte.onboarding.hierGesetzt : worte.onboarding.ausPersonio}
            onBlur={(ev) => {
              const wert = ev.target.value.trim() || null;
              if (wert !== (e.abteilung ?? null)) {
                abteilung.mutate({ employee_id: e.employee_id!, abteilung: wert });
              }
            }}
          />
        ) : (
          (e.abteilung ?? "—")
        ),
    },
    { schluessel: "position", titel: worte.onboarding.position, typ: "text", wert: (e) => e.position },
    {
      schluessel: "eintritt",
      titel: worte.onboarding.eintritt,
      typ: "datum",
      suchtext: false,
      wert: (e) => e.eintritt,
      zelle: (e) => (e.eintritt ? DATUM.format(new Date(e.eintritt)) : "—"),
    },
    {
      schluessel: "uebergabe",
      titel: worte.onboarding.uebergabe,
      typ: "datum",
      suchtext: false,
      wert: (e) => e.heruntergeladen_am,
      zelle: (e) =>
        e.heruntergeladen_am ? (
          DATUM.format(new Date(e.heruntergeladen_am))
        ) : darfSchreiben ? (
          <Button size="sm" variant="outline" onClick={() => paket.mutate(e)}>
            <Check className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {worte.onboarding.vermerken}
          </Button>
        ) : (
          "—"
        ),
    },
    {
      schluessel: "aktionen",
      titel: "",
      typ: "text",
      sortierbar: false,
      suchtext: false,
      wert: () => null,
      ausrichtung: "end",
      zelle: (e) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            title={worte.onboarding.paketTitel}
            disabled={paketDrucken.isPending}
            onClick={() => paketDrucken.mutate(e)}
          >
            <FileDown className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {worte.onboarding.paket}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={worte.onboarding.uebersichtTitel}
            disabled={uebersichtDrucken.isPending}
            onClick={() => uebersichtDrucken.mutate(e)}
          >
            {worte.onboarding.uebersicht}
          </Button>
          {e.employee_id !== null ? (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={offen === e.employee_id}
              onClick={() => setOffen(offen === e.employee_id ? null : e.employee_id)}
            >
              {offen === e.employee_id ? worte.onboarding.planZu : worte.onboarding.plan}
            </Button>
          ) : (
            darfSchreiben && (
              <ConfirmDeleteButton
                itemLabel={e.name}
                onConfirm={() => externWeg.mutateAsync(e.extern_id!).then(() => undefined)}
              />
            )
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Datentabelle
        zeilen={liste}
        spalten={spalten}
        zeilenSchluessel={(e) => e.employee_id ?? e.extern_id ?? e.name}
        laedt={eintritte.isPending}
        leer={worte.onboarding.keineEintritteText}
        beschriftung={worte.onboarding.eintritteTitel}
        werkzeuge={
          <Segmentwahl
            wert={wahl}
            onChange={setWahl}
            beschriftung={worte.onboarding.personenwahl}
            optionen={[
              { wert: "neu", titel: worte.onboarding.neu90, anzahl: anzahl("neu") },
              { wert: "aktive", titel: worte.onboarding.aktive, anzahl: anzahl("aktive") },
              { wert: "alle", titel: worte.onboarding.alle, anzahl: anzahl("alle") },
            ]}
          />
        }
        unterZeile={(e) =>
          e.employee_id !== null && offen === e.employee_id ? (
            <Plan employeeId={e.employee_id} darfSchreiben={darfSchreiben} />
          ) : null
        }
      />

      {darfSchreiben && (
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div>
            <h3 className="font-medium">{worte.onboarding.ohnePersonio}</h3>
            <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
              {worte.onboarding.ohnePersonioHinweis}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <Label htmlFor="extern-name">{worte.onboarding.name}</Label>
              <Input id="extern-name" value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="extern-abteilung">{worte.onboarding.abteilung}</Label>
              <Input
                id="extern-abteilung"
                className="w-40"
                value={neu.abteilung}
                onChange={(e) => setNeu({ ...neu, abteilung: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="extern-position">{worte.onboarding.position}</Label>
              <Input
                id="extern-position"
                className="w-40"
                value={neu.position}
                onChange={(e) => setNeu({ ...neu, position: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="extern-eintritt">{worte.onboarding.eintritt}</Label>
              <Input
                id="extern-eintritt"
                type="date"
                value={neu.eintritt}
                onChange={(e) => setNeu({ ...neu, eintritt: e.target.value })}
              />
            </div>
            <Button disabled={!neu.name.trim() || externAnlegen.isPending} onClick={() => externAnlegen.mutate()}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {worte.onboarding.anlegen}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Der Schulungsplan einer Person — Soll und Ist nebeneinander. */
function Plan({ employeeId, darfSchreiben }: { employeeId: number; darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: onboardingKeys.plan(employeeId),
    queryFn: () => onboardingApi.plan(employeeId),
  });

  const planAnlegen = useMutation({
    mutationFn: () => onboardingApi.planAnlegen(employeeId),
    onSuccess: (anzahl) => {
      toast.success(anzahl === 0 ? worte.onboarding.nichtsGefehlt : worte.onboarding.angelegt(anzahl));
      queryClient.invalidateQueries({ queryKey: ["schulungen"] });
      return queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const zeilen = plan.data ?? [];
  const hinweis = zeilen.find((z) => z.quelle === "kuerzel_fehlt");
  const echte = useMemo(() => (plan.data ?? []).filter((z) => z.quelle !== "kuerzel_fehlt"), [plan.data]);

  const spalten: Tabellenspalte<Planzeile>[] = [
    { schluessel: "name", titel: worte.onboarding.schulung, typ: "text", wert: (z) => z.name },
    { schluessel: "bereich", titel: worte.onboarding.bereich, typ: "text", wert: (z) => z.bereich },
    { schluessel: "turnus", titel: worte.onboarding.turnus, typ: "text", wert: (z) => z.turnus },
    {
      schluessel: "quelle",
      titel: worte.onboarding.pflichtUeber,
      typ: "text",
      wert: (z) => `${z.quelle} ${z.abteilung ?? ""}`,
      zelle: (z) => (
        <Badge variant="outline">
          {z.quelle === "personio" ? worte.onboarding.ueberAbteilung : worte.onboarding.ueberKuerzel} {z.abteilung}
        </Badge>
      ),
    },
    {
      schluessel: "stand",
      titel: worte.onboarding.stand,
      typ: "zahl",
      wert: (z) => Number(z.vorhanden),
      suchtext: (z) => (z.vorhanden ? worte.onboarding.vorhanden : worte.onboarding.fehlt),
      zelle: (z) =>
        z.vorhanden ? (
          <Badge variant="secondary">{worte.onboarding.vorhanden}</Badge>
        ) : (
          <Badge>{worte.onboarding.fehlt}</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-3 text-start">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">{worte.onboarding.schulungsplan}</h3>
        {darfSchreiben && (
          <Button disabled={planAnlegen.isPending} onClick={() => planAnlegen.mutate()}>
            {worte.onboarding.fehlendeAnlegen}
          </Button>
        )}
      </div>
      {plan.isPending ? (
        <p className="text-sm text-[var(--fg-muted)]">{worte.onboarding.wirdGerechnet}</p>
      ) : (
        <>
          {hinweis && (
            <p className="rounded-md bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-3 text-sm">
              {worte.onboarding.kuerzelFehlt(hinweis.abteilung ? `„${hinweis.abteilung}“ ` : "")}
            </p>
          )}
          <Datentabelle
            zeilen={echte}
            spalten={spalten}
            zeilenSchluessel={(z) => `${z.schulung_id}-${z.quelle}`}
            leer={worte.onboarding.matrixVerlangtNichts}
            beschriftung={worte.onboarding.schulungsplan}
          />
        </>
      )}
    </div>
  );
}
