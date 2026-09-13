"use client";

import { useCallback, useMemo, useState } from "react";
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
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";
import { Klappbar } from "../klappbar";
import { Segmentwahl } from "../segmentwahl";
import { Standortfilter, umschalten } from "../standortfilter";
import { Blaettern, Matrixsuche, useMatrixseiten } from "../matrixseiten";

const EBENEN: Pflicht["ebene"][] = ["kuerzel", "personio"];

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

/** Anforderungsmatrix: welche Schulung für welche Abteilung Pflicht ist. */
function Anforderungsmatrix({ katalog, darfSchreiben }: { katalog: Schulung[]; darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [ebene, setEbene] = useState<Pflicht["ebene"]>("kuerzel");

  const pflicht = useQuery({ queryKey: schulungKeys.pflicht(), queryFn: schulungApi.pflicht });
  const achse = useQuery({
    queryKey: ["schulungen", "pflicht-achse", ebene, (pflicht.data ?? []).length],
    queryFn: () => schulungApi.pflichtAchse(ebene, pflicht.data ?? []),
    enabled: pflicht.data !== undefined,
  });

  const gesetzt = useMemo(
    () =>
      new Set(
        (pflicht.data ?? [])
          .filter((p) => p.ebene === ebene)
          .map((p) => `${p.schulung_id}|${p.abteilung}`),
      ),
    [pflicht.data, ebene],
  );

  const setzen = useMutation({
    mutationFn: (w: { schulung_id: string; abteilung: string; an: boolean }) =>
      schulungApi.pflichtSetzen(w.schulung_id, ebene, w.abteilung, w.an),
    onMutate: async (w) => {
      const schluessel = schulungKeys.pflicht();
      await queryClient.cancelQueries({ queryKey: schluessel });
      const vorher = queryClient.getQueryData<Pflicht[]>(schluessel);
      queryClient.setQueryData<Pflicht[]>(schluessel, (alt = []) =>
        w.an
          ? [...alt, { id: `neu:${w.schulung_id}`, schulung_id: w.schulung_id, ebene, abteilung: w.abteilung }]
          : alt.filter((p) => !(p.schulung_id === w.schulung_id && p.ebene === ebene && p.abteilung === w.abteilung)),
      );
      return { vorher };
    },
    onError: (fehler: Error, _w, kontext) => {
      if (kontext?.vorher) queryClient.setQueryData(schulungKeys.pflicht(), kontext.vorher);
      toast.error(fehler.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: schulungKeys.pflicht() }),
  });

  const zeilen = useMemo(
    () => [...katalog].sort((a, b) => a.bereich.localeCompare(b.bereich) || a.name.localeCompare(b.name)),
    [katalog],
  );
  const suchwert = useCallback((s: Schulung) => `${s.bereich} ${s.name}`, []);
  const seiten = useMatrixseiten(zeilen, suchwert);
  const spalten = achse.data ?? [];

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmentwahl
          wert={ebene}
          onChange={setEbene}
          beschriftung={worte.schulungenReg.ebene}
          optionen={EBENEN.map((e) => ({
            wert: e,
            titel: e === "kuerzel" ? worte.schulung.kuerzel : worte.schulung.personioAbteilung,
          }))}
        />
        {seiten.zeigeSuche && (
          <Matrixsuche wert={seiten.suchtext} onChange={seiten.setSuchtext} beschriftung={worte.schulungenReg.anforderungsmatrix} />
        )}
      </div>
      <p className="text-sm text-[var(--fg-muted)]">
        {ebene === "kuerzel" ? worte.schulung.kuerzelHinweis : worte.schulung.personioHinweis}
      </p>
      {zeilen.length === 0 || spalten.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">{worte.schulungenReg.matrixLeer}</p>
      ) : (
        <>
          <div className="max-h-[70vh] overflow-auto rounded-md border border-[var(--border)]">
            <table className="border-collapse text-sm" aria-label={worte.schulungenReg.anforderungsmatrix}>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky start-0 top-0 z-20 min-w-72 border-b border-e border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium"
                  >
                    {worte.schulungen.schulung}
                  </th>
                  {spalten.map((a) => (
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
                {seiten.fenster.zeilen.map((s) => (
                  <tr key={s.id}>
                    <th
                      scope="row"
                      title={`${s.bereich} · ${s.name}`}
                      className="sticky start-0 z-10 max-w-96 truncate border-b border-e border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-start font-normal"
                    >
                      <span className="text-[var(--fg-muted)]">{s.bereich}</span> · {s.name}
                    </th>
                    {spalten.map((a) => {
                      const an = gesetzt.has(`${s.id}|${a}`);
                      return (
                        <td key={a} className="border-b border-[var(--border)] px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={an}
                            disabled={!darfSchreiben}
                            aria-label={`${s.name} – ${a}`}
                            onChange={() => setzen.mutate({ schulung_id: s.id, abteilung: a, an: !an })}
                            className="h-4 w-4 cursor-pointer accent-[var(--ring)] disabled:cursor-default"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {seiten.fenster.gesamt === 0 && (
                  <tr>
                    <td colSpan={spalten.length + 1} className="px-3 py-2 text-[var(--fg-muted)]">
                      {worte.tabelle.keineTreffer}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Blaettern fenster={seiten.fenster} onSeite={seiten.setSeite} beschriftung={worte.schulungenReg.anforderungsmatrix} />
        </>
      )}
    </div>
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
