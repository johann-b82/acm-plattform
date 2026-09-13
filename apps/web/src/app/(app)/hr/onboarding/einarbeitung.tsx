"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, Plus } from "lucide-react";

import {
  abteilungsachse,
  einarbeitungApi,
  einarbeitungKeys,
  type Inhalt,
  type Pflicht,
} from "@/lib/einarbeitung";
import { onboardingApi, onboardingKeys } from "@/lib/onboarding";
import { computeFetch } from "@/lib/compute";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useTexte } from "@/components/sprache/anbieter";
import { Blaettern, Matrixsuche, useMatrixseiten } from "../matrixseiten";

/**
 * Die Einarbeitungsinhalte: was eine neue Person lernen muss, wer es ihr
 * zeigt — und der persönliche Bogen daraus.
 *
 * Ein Inhalt gehört einem Ansprechpartner, nicht einer Abteilung. Welche
 * Abteilung ihn braucht, sagt die Matrix — sonst stünde derselbe Inhalt für
 * jede Abteilung noch einmal da. Gepflegt wird wie im Altsystem direkt in der
 * Zeile; einen eigenen Bearbeitungsmodus hat die Referenz hier nicht.
 */
export function Einarbeitungsinhalte({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState("");
  const [fuer, setFuer] = useState("");

  const katalog = useQuery({ queryKey: einarbeitungKeys.katalog(), queryFn: einarbeitungApi.katalog });
  const pflicht = useQuery({ queryKey: einarbeitungKeys.pflicht(), queryFn: einarbeitungApi.pflicht });
  const eintritte = useQuery({ queryKey: onboardingKeys.eintritte(), queryFn: onboardingApi.eintritte });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["einarbeitung"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const anlegen = useMutation({
    mutationFn: () =>
      einarbeitungApi.anlegen(
        neu.trim(),
        Math.max(0, ...(katalog.data ?? []).map((i) => i.reihenfolge)) + 1,
      ),
    onSuccess: () => {
      setNeu("");
      return neuLaden();
    },
    onError: melde,
  });

  const aendern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Partial<Inhalt> }) =>
      einarbeitungApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const weg = useMutation({
    mutationFn: (id: string) => einarbeitungApi.loeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  /** Der Bogen kommt als PDF von `compute` — mit Token, also nicht als Link. */
  const bogen = useMutation({
    mutationFn: async (frage: Record<string, string>) => {
      const antwort = await computeFetch(einarbeitungApi.bogenUrl(frage));
      if (!antwort.ok) {
        throw new Error((await antwort.text()).slice(0, 200) || `HTTP ${antwort.status}`);
      }
      const url = URL.createObjectURL(await antwort.blob());
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: melde,
  });

  const personen = (eintritte.data ?? []).filter((e) => e.employee_id !== null);
  const gewaehlt = personen.find((e) => String(e.employee_id) === fuer);

  const spalten: Tabellenspalte<Inhalt>[] = [
    {
      schluessel: "inhalt",
      titel: worte.einarbeitung.inhalt,
      typ: "text",
      wert: (i) => i.inhalt,
      zelle: (i) => (
        <Input
          className="min-w-56"
          defaultValue={i.inhalt}
          aria-label={worte.einarbeitung.inhalt}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const wert = e.target.value.trim();
            if (!wert) e.target.value = i.inhalt;
            else if (wert !== i.inhalt) aendern.mutate({ id: i.id, felder: { inhalt: wert } });
          }}
        />
      ),
    },
    {
      schluessel: "ansprechpartner",
      titel: worte.einarbeitung.ansprechpartner,
      typ: "text",
      wert: (i) => i.ansprechpartner,
      zelle: (i) => (
        <Input
          defaultValue={i.ansprechpartner ?? ""}
          placeholder="—"
          aria-label={worte.einarbeitung.ansprechpartner}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const wert = e.target.value.trim() || null;
            if (wert !== i.ansprechpartner) {
              aendern.mutate({ id: i.id, felder: { ansprechpartner: wert } });
            }
          }}
        />
      ),
    },
    {
      schluessel: "bereich",
      titel: worte.einarbeitung.bereich,
      typ: "text",
      wert: (i) => i.bereich,
      zelle: (i) => (
        <Input
          className="w-32"
          defaultValue={i.bereich ?? ""}
          placeholder={worte.einarbeitung.abteilung}
          title={worte.einarbeitung.bereichLeer}
          aria-label={worte.einarbeitung.bereich}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const wert = e.target.value.trim() || null;
            if (wert !== i.bereich) aendern.mutate({ id: i.id, felder: { bereich: wert } });
          }}
        />
      ),
    },
    {
      schluessel: "aktion",
      titel: "",
      typ: "text",
      sortierbar: false,
      suchtext: false,
      wert: () => null,
      ausrichtung: "end",
      zelle: (i) =>
        darfSchreiben ? (
          <ConfirmDeleteButton
            itemLabel={i.inhalt}
            onConfirm={() => weg.mutateAsync(i.id).then(() => undefined)}
          />
        ) : null,
    },
  ];

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-col gap-1">
          <Label htmlFor="bogen-person">{worte.einarbeitung.bogenErzeugen}</Label>
          <Select id="bogen-person" value={fuer} onChange={(e) => setFuer(e.target.value)}>
            <option value="">{worte.einarbeitung.waehlen}</option>
            {personen.map((p) => (
              <option key={p.employee_id} value={String(p.employee_id)}>
                {p.name}
                {p.abteilung ? ` · ${p.abteilung}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="outline"
          disabled={!gewaehlt || bogen.isPending}
          onClick={() => bogen.mutate({ employee_id: fuer })}
        >
          <FileDown className="me-1.5 h-4 w-4" aria-hidden />
          {bogen.isPending ? worte.einarbeitung.wirdGebaut : worte.einarbeitung.einarbeitungsplan}
        </Button>
        {gewaehlt && (
          <span className="text-sm text-[var(--fg-muted)]">
            {(pflicht.data ?? []).length === 0
              ? worte.einarbeitung.keineInhalte
              : worte.einarbeitung.abteilungVon(gewaehlt.abteilung ?? "—")}
          </span>
        )}
      </div>

      {darfSchreiben && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Label htmlFor="neuer-inhalt">{worte.einarbeitung.neuerInhalt}</Label>
            <Input
              id="neuer-inhalt"
              value={neu}
              placeholder={worte.einarbeitung.beispiel}
              onChange={(e) => setNeu(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && neu.trim()) anlegen.mutate();
              }}
            />
          </div>
          <Button disabled={!neu.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {worte.einarbeitung.anlegen}
          </Button>
        </div>
      )}

      <Datentabelle
        zeilen={katalog.data ?? []}
        spalten={spalten}
        zeilenSchluessel={(i) => i.id}
        laedt={katalog.isPending}
        leer={worte.einarbeitung.keinInhaltText}
        beschriftung={worte.onboarding.inhalteTitel}
      />
    </div>
  );
}

/**
 * Welcher Inhalt für welche Abteilung nötig ist — als Häkchenmatrix wie im
 * Altsystem (ONB-04). Zeilen sind Inhalte, Spalten Abteilungen. Ein Häkchen
 * gilt sofort; die Referenz kennt hier keinen Bearbeitungsmodus. Die
 * Zuordnungen selbst sind dieselben Zeilen in `einarbeitung_pflicht` wie
 * vorher, nur anders dargestellt.
 */
export function Einarbeitungsmatrix({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();

  const katalog = useQuery({ queryKey: einarbeitungKeys.katalog(), queryFn: einarbeitungApi.katalog });
  const pflicht = useQuery({ queryKey: einarbeitungKeys.pflicht(), queryFn: einarbeitungApi.pflicht });
  const personio = useQuery({
    queryKey: ["einarbeitung", "abteilungen"],
    queryFn: einarbeitungApi.personioAbteilungen,
  });

  const katalogDaten = katalog.data;
  const inhalte = useMemo(() => katalogDaten ?? [], [katalogDaten]);
  const achse = useMemo(
    () => abteilungsachse(personio.data ?? [], (pflicht.data ?? []).map((p) => p.abteilung)),
    [personio.data, pflicht.data],
  );
  const gesetzt = useMemo(
    () => new Set((pflicht.data ?? []).map((p) => `${p.einarbeitung_id}|${p.abteilung}`)),
    [pflicht.data],
  );

  const setzen = useMutation({
    mutationFn: (w: { id: string; abteilung: string; an: boolean }) =>
      einarbeitungApi.pflichtSetzen(w.id, w.abteilung, w.an),
    // Das Häkchen soll sofort stehen, nicht erst nach der Antwort.
    onMutate: async (w) => {
      const schluessel = einarbeitungKeys.pflicht();
      await queryClient.cancelQueries({ queryKey: schluessel });
      const vorher = queryClient.getQueryData<Pflicht[]>(schluessel);
      queryClient.setQueryData<Pflicht[]>(schluessel, (alt = []) =>
        w.an
          ? [...alt, { id: `neu:${w.id}|${w.abteilung}`, einarbeitung_id: w.id, abteilung: w.abteilung }]
          : alt.filter((p) => !(p.einarbeitung_id === w.id && p.abteilung === w.abteilung)),
      );
      return { vorher };
    },
    onError: (fehler: Error, _w, kontext) => {
      if (kontext?.vorher) queryClient.setQueryData(einarbeitungKeys.pflicht(), kontext.vorher);
      toast.error(fehler.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: einarbeitungKeys.pflicht() }),
  });

  const suchwert = useCallback((i: Inhalt) => `${i.inhalt} ${i.ansprechpartner ?? ""}`, []);
  const seiten = useMatrixseiten(inhalte, suchwert);

  if (katalog.isPending || pflicht.isPending) {
    return <p className="p-4 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</p>;
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">{worte.onboarding.matrixHinweis}</p>
        {seiten.zeigeSuche && (
          <Matrixsuche
            wert={seiten.suchtext}
            onChange={seiten.setSuchtext}
            beschriftung={worte.onboarding.matrixTitel}
          />
        )}
      </div>
      {inhalte.length === 0 || achse.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">{worte.onboarding.matrixLeer}</p>
      ) : (
        <>
          <div className="max-h-[70vh] overflow-auto rounded-md border border-[var(--border)]">
            <table className="border-collapse text-sm" aria-label={worte.onboarding.matrixTitel}>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky start-0 top-0 z-20 min-w-64 border-b border-e border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium"
                  >
                    {worte.einarbeitung.inhalt}
                  </th>
                  {achse.map((a) => (
                    <th
                      key={a}
                      scope="col"
                      title={a}
                      className="sticky top-0 z-10 whitespace-nowrap border-b border-[var(--border)] bg-[var(--muted)] px-2 py-2 text-center text-xs font-medium"
                    >
                      {a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seiten.fenster.zeilen.map((i) => (
                  <tr key={i.id}>
                    <th
                      scope="row"
                      title={i.inhalt}
                      className="sticky start-0 z-10 max-w-96 truncate border-b border-e border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-start font-normal"
                    >
                      {i.inhalt}
                    </th>
                    {achse.map((a) => {
                      const an = gesetzt.has(`${i.id}|${a}`);
                      return (
                        <td key={a} className="border-b border-[var(--border)] px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={an}
                            disabled={!darfSchreiben}
                            aria-label={worte.onboarding.matrixZelle(i.inhalt, a)}
                            onChange={() => setzen.mutate({ id: i.id, abteilung: a, an: !an })}
                            className="h-4 w-4 cursor-pointer accent-[var(--ring)] disabled:cursor-default"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {seiten.fenster.gesamt === 0 && (
                  <tr>
                    <td colSpan={achse.length + 1} className="px-3 py-2 text-[var(--fg-muted)]">
                      {worte.tabelle.keineTreffer}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Blaettern
            fenster={seiten.fenster}
            onSeite={seiten.setSeite}
            beschriftung={worte.onboarding.matrixTitel}
          />
        </>
      )}
    </div>
  );
}
