"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  schulungApi,
  schulungKeys,
  standBelegschaft,
  standorte,
  imStandort,
  tagesdatum,
  type Person,
  type Pflicht,
  type Schulung,
} from "@/lib/schulungen";
import { positionNorm } from "@/lib/pflicht";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";
import { Klappbar } from "../klappbar";
import { Standortfilter, umschalten } from "../standortfilter";
import { Pflichtmatrix, type PflichtmatrixApi } from "../pflichtmatrix";

/** Register „Schulung zuweisen“: Anforderungsmatrix, Einzelzuweisung, Sammelabschluss. */
export function RegisterZuweisen({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const katalog = useQuery({ queryKey: schulungKeys.katalog(), queryFn: schulungApi.katalog });
  const belegschaft = useQuery({ queryKey: schulungKeys.belegschaft(), queryFn: schulungApi.belegschaft });

  return (
    <div className="space-y-6">
      <Klappbar titel={worte.schulungenReg.anforderungsmatrix} offenStart={false}>
        <Anforderungsmatrix katalog={katalog.data ?? []} darfSchreiben={darfSchreiben} />
      </Klappbar>
      {darfSchreiben && (
        <Klappbar titel={worte.schulungenReg.einzelTitel} offenStart={false}>
          <Einzelzuweisung katalog={katalog.data ?? []} personen={belegschaft.data ?? []} />
        </Klappbar>
      )}
      {darfSchreiben && (
        <Klappbar titel={worte.schulungenReg.sammelTitel} offenStart={false}>
          <Sammelabschluss katalog={katalog.data ?? []} personen={belegschaft.data ?? []} />
        </Klappbar>
      )}
    </div>
  );
}

/** Anforderungsmatrix: für wen welche Schulung Pflicht ist — alle, Abteilung, Position, Kombination. */
function Anforderungsmatrix({ katalog, darfSchreiben }: { katalog: Schulung[]; darfSchreiben: boolean }) {
  const worte = useTexte();
  const pflicht = useQuery({ queryKey: schulungKeys.pflicht(), queryFn: schulungApi.pflicht });

  const api = useMemo<PflichtmatrixApi<Pflicht>>(
    () => ({
      bereich: "schulungen",
      pflichten: pflicht.data ?? [],
      pflichtKey: schulungKeys.pflicht(),
      zielId: (p) => p.schulung_id,
      neuePflicht: (schulung_id, geltung, abteilung, position) => ({
        id: `neu:${schulung_id}:${geltung}:${abteilung ?? ""}:${position ?? ""}`,
        schulung_id,
        geltung,
        abteilung,
        position,
        position_norm: position ? positionNorm(position) : null,
      }),
      achse: schulungApi.pflichtAchse,
      setzen: schulungApi.pflichtSetzen,
    }),
    [pflicht.data],
  );

  const zeilen = useMemo(
    () => [...katalog].sort((a, b) => a.bereich.localeCompare(b.bereich) || a.name.localeCompare(b.name)),
    [katalog],
  );

  return (
    <Pflichtmatrix
      api={api}
      zugriff={{
        zeilen,
        id: (s) => s.id,
        kopf: (s) => (
          <>
            <span className="text-[var(--fg-muted)]">{s.bereich}</span> · {s.name}
          </>
        ),
        titel: (s) => `${s.bereich} · ${s.name}`,
        suchwert: (s) => `${s.bereich} ${s.name}`,
      }}
      spaltenKopf={worte.schulungen.schulung}
      beschriftung={worte.schulungenReg.anforderungsmatrix}
      darfSchreiben={darfSchreiben}
    />
  );
}

/** Eine Schulung einer einzelnen Person zuweisen — ergänzt die Abteilungsmatrix. */
function Einzelzuweisung({ katalog, personen }: { katalog: Schulung[]; personen: Person[] }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [schulung, setSchulung] = useState("");
  const [wer, setWer] = useState("");
  const [gewaehlteOrte, setGewaehlteOrte] = useState<Set<string>>(new Set());

  const wahl = useMemo(() => standBelegschaft(personen), [personen]);
  const orte = useMemo(() => standorte(wahl), [wahl]);
  const gefiltert = useMemo(() => wahl.filter((p) => imStandort(p, gewaehlteOrte)), [wahl, gewaehlteOrte]);

  const zuweisen = useMutation({
    mutationFn: () => {
      const person = wahl.find((p) => p.schluessel === wer);
      if (!person) throw new Error(worte.schulungenReg.mitarbeiterWaehlen);
      return schulungApi.zuweisen(schulung, person);
    },
    onSuccess: () => {
      toast.success(worte.schulungenReg.zugewiesen);
      setSchulung("");
      setWer("");
      return queryClient.invalidateQueries({ queryKey: ["schulungen"] });
    },
    onError: (fehler: Error) =>
      toast.error(/duplicate|unique/i.test(fehler.message) ? worte.schulungenReg.schonZugewiesen : fehler.message),
  });

  const auswahl = "h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm";
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-[var(--fg-muted)]">{worte.schulungenReg.einzelHinweis}</p>
      <Standortfilter standorte={orte} gewaehlt={gewaehlteOrte} beschriftung={worte.schulungenReg.standort} onToggle={(o) => setGewaehlteOrte((v) => umschalten(v, o))} />
      <div className="flex flex-wrap items-center gap-2">
        <select className={auswahl} aria-label={worte.schulungenReg.mitarbeiterWaehlen} value={wer} onChange={(e) => setWer(e.target.value)}>
          <option value="">{worte.schulungenReg.mitarbeiterWaehlen}</option>
          {gefiltert.map((p) => (
            <option key={p.schluessel} value={p.schluessel}>
              {p.name}
              {p.abteilung ? ` · ${p.abteilung}` : ""}
              {p.standort ? ` · ${p.standort}` : ""}
            </option>
          ))}
        </select>
        <select className={auswahl} aria-label={worte.schulungenReg.schulungWaehlen} value={schulung} onChange={(e) => setSchulung(e.target.value)}>
          <option value="">{worte.schulungenReg.schulungWaehlen}</option>
          {katalog.map((s) => (
            <option key={s.id} value={s.id}>
              {s.bereich} · {s.name}
            </option>
          ))}
        </select>
        <Button disabled={!wer || !schulung || zuweisen.isPending} onClick={() => zuweisen.mutate()}>
          {worte.schulungenReg.zuweisenAktion}
        </Button>
      </div>
    </div>
  );
}

/** Sammelabschluss (SCH-05): eine Schulung, ein Datum, mehrere Teilnehmer. */
function Sammelabschluss({ katalog, personen }: { katalog: Schulung[]; personen: Person[] }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [schulung, setSchulung] = useState("");
  const [datum, setDatum] = useState(tagesdatum(new Date()));
  const [suche, setSuche] = useState("");
  const [gewaehlteOrte, setGewaehlteOrte] = useState<Set<string>>(new Set());
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());

  const wahl = useMemo(() => standBelegschaft(personen), [personen]);
  const orte = useMemo(() => standorte(wahl), [wahl]);
  const gefiltert = useMemo(() => {
    const text = suche.trim().toLocaleLowerCase("de");
    return wahl
      .filter((p) => imStandort(p, gewaehlteOrte))
      .filter((p) => !text || (p.name ?? "").toLocaleLowerCase("de").includes(text));
  }, [wahl, gewaehlteOrte, suche]);

  const eintragen = useMutation({
    mutationFn: () => schulungApi.sammelabschluss(schulung, datum, [...gewaehlt]),
    onSuccess: (r) => {
      toast.success(worte.schulungenReg.sammelErfolg(r.eingetragen, r.unveraendert));
      setGewaehlt(new Set());
      return queryClient.invalidateQueries({ queryKey: ["schulungen"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const teilnehmerUmschalten = (schluessel: string) => setGewaehlt((v) => umschalten(v, schluessel));
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-[var(--fg-muted)]">{worte.schulungenReg.sammelHinweis}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <Label htmlFor="sammel-schulung">{worte.schulungenReg.schulungWaehlen}</Label>
          <Select id="sammel-schulung" value={schulung} onChange={(e) => setSchulung(e.target.value)}>
            <option value="">{worte.schulungenReg.schulungWaehlen}</option>
            {katalog.map((s) => (
              <option key={s.id} value={s.id}>
                {s.bereich} · {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sammel-datum">{worte.schulungenReg.durchgefuehrtAm}</Label>
          <Input id="sammel-datum" type="date" value={datum} max={tagesdatum(new Date())} onChange={(e) => setDatum(e.target.value)} />
        </div>
      </div>
      <Standortfilter standorte={orte} gewaehlt={gewaehlteOrte} beschriftung={worte.schulungenReg.standort} onToggle={(o) => setGewaehlteOrte((v) => umschalten(v, o))} />
      <Input
        type="search"
        value={suche}
        placeholder={worte.schulungenReg.teilnehmerSuche}
        aria-label={worte.schulungenReg.teilnehmerSuche}
        onChange={(e) => setSuche(e.target.value)}
      />
      <div className="max-h-64 overflow-auto rounded-md border border-[var(--border)]">
        {gefiltert.map((p) => (
          <label key={p.schluessel} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)]">
            <input
              type="checkbox"
              checked={gewaehlt.has(p.schluessel)}
              onChange={() => teilnehmerUmschalten(p.schluessel)}
              className="h-4 w-4 accent-[var(--ring)]"
            />
            {p.name}
            {p.abteilung && <span className="text-[var(--fg-muted)]">· {p.abteilung}</span>}
            {p.standort && <span className="text-[var(--fg-muted)]">· {p.standort}</span>}
          </label>
        ))}
        {gefiltert.length === 0 && <p className="px-3 py-2 text-sm text-[var(--fg-muted)]">{worte.tabelle.keineTreffer}</p>}
      </div>
      <Button
        disabled={!schulung || !datum || gewaehlt.size === 0 || eintragen.isPending}
        onClick={() => eintragen.mutate()}
      >
        {worte.schulungenReg.sammelAktion(gewaehlt.size)}
      </Button>
    </div>
  );
}
