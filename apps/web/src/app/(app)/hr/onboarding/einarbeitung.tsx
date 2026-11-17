"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, Plus } from "lucide-react";

import {
  einarbeitungApi,
  einarbeitungKeys,
  type Inhalt,
  type Pflicht,
  type UploadErgebnis,
} from "@/lib/einarbeitung";
import { positionNorm } from "@/lib/pflicht";
import { onboardingApi, onboardingKeys } from "@/lib/onboarding";
import { computeFetch } from "@/lib/compute";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useTexte } from "@/components/sprache/anbieter";
import { Pflichtmatrix, type PflichtmatrixApi } from "../pflichtmatrix";

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
 * Für wen welcher Inhalt Pflicht ist (ONB-04) — dieselbe Anforderungsmatrix
 * wie bei den Schulungen: alle, Abteilung, Position oder die Kombination
 * beider. Die Zuordnungen sind Zeilen in `einarbeitung_pflicht`.
 */
export function Einarbeitungsmatrix({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();

  const katalog = useQuery({ queryKey: einarbeitungKeys.katalog(), queryFn: einarbeitungApi.katalog });
  const pflicht = useQuery({ queryKey: einarbeitungKeys.pflicht(), queryFn: einarbeitungApi.pflicht });

  const inhalte = useMemo(() => katalog.data ?? [], [katalog.data]);

  const api = useMemo<PflichtmatrixApi<Pflicht>>(
    () => ({
      bereich: "einarbeitung",
      pflichten: pflicht.data ?? [],
      pflichtKey: einarbeitungKeys.pflicht(),
      zielId: (p) => p.einarbeitung_id,
      neuePflicht: (einarbeitung_id, geltung, abteilung, position) => ({
        id: `neu:${einarbeitung_id}:${geltung}:${abteilung ?? ""}:${position ?? ""}`,
        einarbeitung_id,
        geltung,
        abteilung,
        position,
        position_norm: position ? positionNorm(position) : null,
      }),
      achse: einarbeitungApi.pflichtAchse,
      setzen: einarbeitungApi.pflichtSetzen,
    }),
    [pflicht.data],
  );

  if (katalog.isPending || pflicht.isPending) {
    return <p className="p-4 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</p>;
  }

  return (
    <Pflichtmatrix
      api={api}
      zugriff={{
        zeilen: inhalte,
        id: (i) => i.id,
        kopf: (i) => i.inhalt,
        titel: (i) => i.inhalt,
        suchwert: (i) => `${i.inhalt} ${i.ansprechpartner ?? ""}`,
      }}
      spaltenKopf={worte.einarbeitung.inhalt}
      beschriftung={worte.onboarding.matrixTitel}
      darfSchreiben={darfSchreiben}
    />
  );
}

/**
 * Serie erzeugen und zentraler Upload: für alle Personen eines Bereichs auf
 * einmal Bögen erzeugen (Druck-PDF) und die unterschriebenen Bögen gesammelt
 * wieder einlesen — die Zuordnung läuft über den QR.
 */
export function Serienbogen({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const [bereich, setBereich] = useState("");
  const [ergebnisse, setErgebnisse] = useState<UploadErgebnis[] | null>(null);
  const melde = (fehler: Error) => toast.error(fehler.message);

  const bereiche = useQuery({
    queryKey: ["einarbeitung", "bereiche"],
    queryFn: einarbeitungApi.bereiche,
  });

  const serie = useMutation({
    mutationFn: async (bereichId: string) => {
      const antwort = await computeFetch(einarbeitungApi.serieUrl(bereichId), { method: "POST" });
      if (!antwort.ok) {
        throw new Error((await antwort.text()).slice(0, 200) || `HTTP ${antwort.status}`);
      }
      const anzahl = Number(antwort.headers.get("X-Serie-Anzahl") ?? "0");
      const url = URL.createObjectURL(await antwort.blob());
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return anzahl;
    },
    onSuccess: (anzahl) => toast.success(worte.einarbeitung.serieFertig(anzahl)),
    onError: melde,
  });

  const upload = useMutation({
    mutationFn: (dateien: File[]) => einarbeitungApi.stapelHochladen(dateien),
    onSuccess: setErgebnisse,
    onError: melde,
  });

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-[var(--fg-muted)]">{worte.einarbeitung.serieHinweis}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-col gap-1">
          <Label htmlFor="serie-bereich">{worte.einarbeitung.bereich}</Label>
          <Select id="serie-bereich" value={bereich} onChange={(e) => setBereich(e.target.value)}>
            <option value="">{worte.einarbeitung.waehlen}</option>
            {(bereiche.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="outline"
          disabled={!darfSchreiben || !bereich || serie.isPending}
          onClick={() => serie.mutate(bereich)}
        >
          <FileDown className="me-1.5 h-4 w-4" aria-hidden />
          {serie.isPending ? worte.einarbeitung.wirdGebaut : worte.einarbeitung.serieErzeugen}
        </Button>
      </div>

      <div className="space-y-2 border-t border-[var(--border)] pt-4">
        <Label htmlFor="serie-upload">{worte.einarbeitung.uploadTitel}</Label>
        <p className="text-sm text-[var(--fg-muted)]">{worte.einarbeitung.uploadHinweis}</p>
        <input
          id="serie-upload"
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg"
          disabled={!darfSchreiben || upload.isPending}
          onChange={(e) => {
            const dateien = Array.from(e.target.files ?? []);
            if (dateien.length) upload.mutate(dateien);
            e.target.value = "";
          }}
          className="block text-sm"
        />
        {upload.isPending && (
          <p className="text-sm text-[var(--fg-muted)]">{worte.einarbeitung.wirdHochgeladen}</p>
        )}
        {ergebnisse && (
          <ul className="space-y-1 text-sm">
            {ergebnisse.map((z, i) => (
              <li key={i} className="flex flex-wrap gap-2">
                <span className="font-medium">{z.dateiname || z.name || "—"}</span>
                <span className="text-[var(--fg-muted)]">
                  {worte.einarbeitung.uploadStatus[z.status]}
                  {z.name ? ` · ${z.name}` : ""}
                  {z.meldung ? ` · ${z.meldung}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
