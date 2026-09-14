"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FileDown, FileUp, Plus } from "lucide-react";

import {
  INTERVALLE,
  STAMMFELDER,
  intervallText,
  laufendesHalbjahr,
  maschinenEingabe,
  wartungApi,
  wartungKeys,
  type Aufgabe,
  type Datei,
  type Intervall,
  type Maschine,
  type MaschinenEntwurf,
  type Status,
} from "@/lib/wartung";
import { computeFetch } from "@/lib/compute";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { ZAHL_TAG } from "@/lib/sprache";
import { useIntervall } from "@/lib/tafeln";

type Stammentwurf = MaschinenEntwurf & { notizen: string };

function entwurfAus(m: Maschine): Stammentwurf {
  return {
    name: m.name,
    inventarnummer: m.inventarnummer ?? "",
    standort: m.standort ?? "",
    hersteller: m.hersteller ?? "",
    modell: m.modell ?? "",
    verantwortlich: m.verantwortlich ?? "",
    status: m.status,
    notizen: m.notizen,
  };
}

export function MaschineAnsicht({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const intervall = useIntervall();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const router = useRouter();
  const jetzt = laufendesHalbjahr();
  const [jahr, setJahr] = useState(jetzt.jahr);
  const [halbjahr, setHalbjahr] = useState<1 | 2>(jetzt.halbjahr);
  const [neu, setNeu] = useState<{ titel: string; intervall: Intervall; wochen: string }>({
    titel: "",
    intervall: "monatlich",
    wochen: "4",
  });
  // EDIT-01: Stammdaten erst lesend, „Bearbeiten" öffnet einen Entwurf.
  const [stamm, setStamm] = useState<Stammentwurf | null>(null);

  const maschine = useQuery({
    queryKey: wartungKeys.maschine(id),
    queryFn: () => wartungApi.maschine(id),
  });
  const aufgaben = useQuery({
    queryKey: wartungKeys.aufgaben(id),
    queryFn: () => wartungApi.aufgaben(id),
  });
  const dateien = useQuery({
    queryKey: wartungKeys.dateien(id),
    queryFn: () => wartungApi.dateien(id),
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["wartung"] });

  const stammSpeichern = useMutation({
    mutationFn: (e: Stammentwurf) =>
      wartungApi.aendern(id, { ...maschinenEingabe(e), notizen: e.notizen }),
    onSuccess: () => {
      setStamm(null);
      toast.success(worte.maschine.gespeichert);
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const anlegen = useMutation({
    mutationFn: () =>
      wartungApi.aufgabeAnlegen(
        id,
        neu.titel.trim(),
        neu.intervall,
        Number(neu.wochen) || null,
      ),
    onSuccess: () => {
      setNeu({ ...neu, titel: "" });
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const aufgabeWeg = useMutation({
    mutationFn: (aufgabe: Aufgabe) => wartungApi.aufgabeLoeschen(aufgabe.id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const hochladen = useMutation({
    mutationFn: ({ art, datei }: { art: Datei["art"]; datei: File }) =>
      wartungApi.dateiHochladen(id, art, datei),
    onSuccess: () => {
      toast.success("Datei hinterlegt.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const dateiWeg = useMutation({
    mutationFn: (datei: Datei) => wartungApi.dateiLoeschen(datei),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const maschineWeg = useMutation({
    mutationFn: () => wartungApi.loeschen(maschine.data!, dateien.data ?? []),
    onSuccess: () => {
      toast.success("Maschine gelöscht.");
      router.push("/produktion");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  /**
   * Der Bogen kommt als PDF von `compute`. Er braucht das Bearer-Token, also
   * kein blanker Link: geholt, als Blob geöffnet, Objekt-URL wieder freigeben.
   */
  const bogen = useMutation({
    mutationFn: async () => {
      const antwort = await computeFetch(
        `/api/wartung/maschinen/${id}/bogen.pdf?jahr=${jahr}&halbjahr=${halbjahr}`,
      );
      if (!antwort.ok) {
        const text = await antwort.text();
        throw new Error(text.slice(0, 200) || `HTTP ${antwort.status}`);
      }
      const blob = await antwort.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const m = maschine.data;
  if (maschine.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</Card>;
  }
  if (!m) {
    return <EmptyState title={worte.maschine.gibtEsNicht} body={worte.maschine.gibtEsNichtText} />;
  }

  const aufgabenSpalten: Tabellenspalte<Aufgabe>[] = [
    {
      schluessel: "titel",
      titel: worte.maschine.aufgabe,
      typ: "text",
      wert: (a) => a.titel,
      zelle: (a) => (
        <Input
          defaultValue={a.titel}
          aria-label={worte.maschine.aufgabe}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const wert = e.target.value.trim();
            if (wert && wert !== a.titel) {
              wartungApi
                .aufgabeAendern(a.id, { titel: wert })
                .then(neuLaden)
                .catch((f: Error) => toast.error(f.message));
            }
          }}
        />
      ),
    },
    {
      schluessel: "intervall",
      titel: worte.maschine.intervall,
      typ: "text",
      wert: (a) => intervallText(a, intervall, worte.maschine.alleNWochenZahl),
    },
    ...(darfSchreiben
      ? [
          {
            schluessel: "loeschen",
            titel: "",
            typ: "text" as const,
            wert: () => null,
            suchtext: false as const,
            sortierbar: false,
            ausrichtung: "end" as const,
            zelle: (a: Aufgabe) => (
              <ConfirmDeleteButton
                itemLabel={a.titel}
                onConfirm={() => aufgabeWeg.mutateAsync(a).then(() => undefined)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{m.name}</h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {[m.hersteller, m.modell].filter(Boolean).join(" · ") || "Ohne Herstellerangabe"}
          </p>
        </div>
        {/* Zurück und das Löschen der ganzen Maschine: in der Schale in der rechten Leiste. */}
        <div className={inSchale ? "contents" : "flex items-center gap-3"}>
          <Seitenwerkzeuge kategorie="navigation">
            <ButtonLink href="/produktion" variant="outline">
              <ArrowLeft className="me-2 h-4 w-4 rtl:rotate-180" aria-hidden />
              {worte.maschine.zurUebersicht}
            </ButtonLink>
          </Seitenwerkzeuge>
          {darfSchreiben && (
            <Seitenwerkzeuge kategorie="aktionen">
              <ConfirmDeleteButton
                itemLabel={m.name}
                onConfirm={() => maschineWeg.mutateAsync().then(() => undefined)}
              />
            </Seitenwerkzeuge>
          )}
        </div>
      </div>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">{worte.maschine.stammdaten}</h2>
          {darfSchreiben && !stamm && (
            <Button size="sm" variant="outline" onClick={() => setStamm(entwurfAus(m))}>
              {worte.maschine.bearbeiten}
            </Button>
          )}
        </div>

        {stamm ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STAMMFELDER.map((feld) => (
                <div key={feld} className="flex flex-col gap-1">
                  <Label htmlFor={feld}>{worte.maschine[feld]}</Label>
                  <Input
                    id={feld}
                    value={stamm[feld]}
                    required={feld === "name"}
                    maxLength={feld === "inventarnummer" ? 64 : 255}
                    onChange={(e) => setStamm({ ...stamm, [feld]: e.target.value })}
                  />
                  {feld === "name" && !stamm.name.trim() && (
                    <span className="text-xs text-[var(--danger)]">{worte.maschine.nameFehlt}</span>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <Label htmlFor="status">{worte.maschine.status}</Label>
                <Select
                  id="status"
                  value={stamm.status}
                  onChange={(e) => setStamm({ ...stamm, status: e.target.value as Status })}
                >
                  <option value="aktiv">{worte.maschine.aktiv}</option>
                  <option value="stillgelegt">{worte.maschine.stillgelegt}</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="notizen">{worte.maschine.notizen}</Label>
              <Textarea
                id="notizen"
                rows={3}
                value={stamm.notizen}
                onChange={(e) => setStamm({ ...stamm, notizen: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!stamm.name.trim() || stammSpeichern.isPending}
                onClick={() => stammSpeichern.mutate(stamm)}
              >
                {worte.allgemein.speichern}
              </Button>
              <Button variant="outline" onClick={() => setStamm(null)}>
                {worte.allgemein.abbrechen}
              </Button>
            </div>
          </>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAMMFELDER.map((feld) => (
              <div key={feld} className="min-w-0">
                <dt className="text-xs text-[var(--fg-muted)]">{worte.maschine[feld]}</dt>
                <dd className="text-sm break-words">{m[feld] || "—"}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-[var(--fg-muted)]">{worte.maschine.status}</dt>
              <dd className="text-sm">
                {m.status === "aktiv" ? worte.maschine.aktiv : worte.maschine.stillgelegt}
              </dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-[var(--fg-muted)]">{worte.maschine.notizen}</dt>
              <dd className="text-sm whitespace-pre-wrap">{m.notizen || "—"}</dd>
            </div>
          </dl>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">{worte.maschine.wartungsaufgaben}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="jahr">{worte.maschine.jahr}</Label>
              <Input
                id="jahr"
                className="w-24 tabular-nums"
                inputMode="numeric"
                value={jahr}
                onChange={(e) => setJahr(Number(e.target.value) || jetzt.jahr)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="halbjahr">{worte.maschine.halbjahr}</Label>
              <Select
                id="halbjahr"
                value={String(halbjahr)}
                onChange={(e) => setHalbjahr(Number(e.target.value) as 1 | 2)}
              >
                <option value="1">{worte.maschine.erstesHalbjahr}</option>
                <option value="2">{worte.maschine.zweitesHalbjahr}</option>
              </Select>
            </div>
            <Button onClick={() => bogen.mutate()} disabled={bogen.isPending}>
              <FileDown className="me-1.5 h-4 w-4" aria-hidden />
              {bogen.isPending ? worte.maschine.wirdGebaut : worte.maschine.nachweisbogen}
            </Button>
          </div>
        </div>

        {darfSchreiben && (
          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="neue-aufgabe">{worte.maschine.neueAufgabe}</Label>
              <Input
                id="neue-aufgabe"
                value={neu.titel}
                placeholder={worte.maschine.aufgabeBeispiel}
                onChange={(e) => setNeu({ ...neu, titel: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && neu.titel.trim()) anlegen.mutate();
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="intervall">{worte.maschine.intervall}</Label>
              <Select
                id="intervall"
                value={neu.intervall}
                onChange={(e) =>
                  setNeu({ ...neu, intervall: e.target.value as Intervall })
                }
              >
                {INTERVALLE.map((i) => (
                  <option key={i.wert} value={i.wert}>
                    {intervall[i.wert]}
                  </option>
                ))}
              </Select>
            </div>
            {neu.intervall === "alle_n_wochen" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="wochen">Wochen</Label>
                <Input
                  id="wochen"
                  className="w-24 tabular-nums"
                  inputMode="numeric"
                  value={neu.wochen}
                  onChange={(e) => setNeu({ ...neu, wochen: e.target.value })}
                />
              </div>
            )}
            <Button
              disabled={!neu.titel.trim() || anlegen.isPending}
              onClick={() => anlegen.mutate()}
            >
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              Hinzufügen
            </Button>
          </div>
        )}

        {!aufgaben.isLoading && (aufgaben.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.maschine.keineAufgabe}
          </p>
        ) : (
          <Datentabelle
            zeilen={aufgaben.data ?? []}
            spalten={aufgabenSpalten}
            zeilenSchluessel={(a) => a.id}
            laedt={aufgaben.isLoading}
            beschriftung={worte.maschine.wartungsaufgaben}
          />
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">{worte.maschine.dateien}</h2>
          {darfSchreiben && (
            <div className="flex gap-2">
              <DateiWahl art="plan" label={worte.maschine.planHinterlegen} hochladen={hochladen} />
              <DateiWahl art="nachweis" label={worte.maschine.nachweisAblegen} hochladen={hochladen} />
            </div>
          )}
        </div>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          {worte.maschine.dateienHinweis}
        </p>
        {(dateien.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">{worte.maschine.keineDatei}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(dateien.data ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                <Badge variant={d.art === "plan" ? "secondary" : "outline"}>
                  {d.art === "plan" ? worte.maschine.plan : worte.maschine.nachweis}
                </Badge>
                <button
                  type="button"
                  className="text-sm underline-offset-4 hover:underline"
                  onClick={() =>
                    wartungApi
                      .dateiUrl(d)
                      .then((url) => window.open(url, "_blank", "noopener"))
                      .catch((f: Error) => toast.error(f.message))
                  }
                >
                  {d.dateiname}
                </button>
                <span className="text-xs text-[var(--fg-muted)]">
                  {DATUM.format(new Date(d.hochgeladen_am))}
                </span>
                {darfSchreiben && (
                  <span className="ms-auto">
                    <ConfirmDeleteButton
                      itemLabel={d.dateiname}
                      onConfirm={() => dateiWeg.mutateAsync(d).then(() => undefined)}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DateiWahl({
  art,
  label,
  hochladen,
}: {
  art: Datei["art"];
  label: string;
  hochladen: { mutate: (v: { art: Datei["art"]; datei: File }) => void; isPending: boolean };
}) {
  const worte = useTexte();
  return (
    <label
      className={
        "inline-flex h-9 cursor-pointer items-center rounded-md border " +
        "border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)] " +
        "focus-within:outline-2 focus-within:outline-[var(--ring)]"
      }
    >
      <FileUp className="me-1.5 h-4 w-4" aria-hidden />
      {hochladen.isPending ? worte.maschine.laedt : label}
      <input
        type="file"
        className="sr-only"
        aria-label={label}
        accept="application/pdf,image/png,image/jpeg"
        disabled={hochladen.isPending}
        onChange={(e) => {
          const datei = e.target.files?.[0];
          e.target.value = "";
          if (datei) hochladen.mutate({ art, datei });
        }}
      />
    </label>
  );
}
