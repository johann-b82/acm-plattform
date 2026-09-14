"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Plus } from "lucide-react";

import {
  dringlichkeit,
  schulungApi,
  schulungKeys,
  type ImportErgebnis,
  type Schulung,
} from "@/lib/schulungen";
import { Badge, Button, Card, Input, Label, Switch } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Seitenwerkzeuge, Werkzeug, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { cn } from "@/lib/cn";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { useDringlichkeit } from "@/lib/tafeln";

/**
 * Register „Schulungen bearbeiten“: der Katalog samt Import.
 *
 * Fälligkeiten werden aus letztem Termin und Turnus gerechnet, nicht
 * gespeichert. Frist, Verantwortlicher und der Aktiv-Schalter werden wie im
 * Altsystem direkt in der Zeile gepflegt.
 *
 * Anlegen und Einlesen stehen in der rechten Leiste; die Vorschau des Imports
 * mit Übernehmen und Abbrechen bleibt über der Tabelle, weil sie Inhalt ist.
 */
export function RegisterBearbeiten({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const dringlichkeitLabel = useDringlichkeit();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState({ bereich: "betrieblich", name: "" });
  const [vorschau, setVorschau] = useState<{ datei: File; ergebnis: ImportErgebnis } | null>(null);

  const katalog = useQuery({ queryKey: schulungKeys.katalog(), queryFn: schulungApi.katalog });
  const stand = useQuery({ queryKey: schulungKeys.stand(), queryFn: schulungApi.stand });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["schulungen"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const zeigen = useMutation({
    mutationFn: (datei: File) => schulungApi.vorschau(datei).then((ergebnis) => ({ datei, ergebnis })),
    onSuccess: setVorschau,
    onError: melde,
  });
  const uebernehmen = useMutation({
    mutationFn: () => schulungApi.uebernehmen(vorschau!.datei),
    onSuccess: (e) => {
      setVorschau(null);
      toast.success(`${e.schulungen} Schulungen, ${e.teilnahmen} Teilnahmen übernommen.`);
      return neuLaden();
    },
    onError: melde,
  });
  const anlegen = useMutation({
    mutationFn: () => schulungApi.anlegen(neu.bereich, neu.name.trim()),
    onSuccess: () => {
      setNeu({ ...neu, name: "" });
      return neuLaden();
    },
    onError: (fehler: Error) =>
      toast.error(/duplicate|unique/i.test(fehler.message) ? "Diese Schulung gibt es in dem Bereich schon." : fehler.message),
  });
  const aendern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Partial<Schulung> }) => schulungApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const liste = useMemo(() => katalog.data ?? [], [katalog.data]);
  const bereiche = useMemo(() => [...new Set(liste.map((s) => s.bereich))], [liste]);
  const offenNach = useMemo(() => {
    const m = new Map<string, { nie: number; ueberfaellig: number; bald: number }>();
    for (const s of stand.data ?? []) {
      const eintrag = m.get(s.schulung_id) ?? { nie: 0, ueberfaellig: 0, bald: 0 };
      const d = dringlichkeit(s);
      if (d === "nie") eintrag.nie += 1;
      else if (d === "ueberfaellig") eintrag.ueberfaellig += 1;
      else if (d === "faellig_bald") eintrag.bald += 1;
      m.set(s.schulung_id, eintrag);
    }
    return m;
  }, [stand.data]);

  const offenSumme = (id: string) => {
    const o = offenNach.get(id);
    return o ? o.nie + o.ueberfaellig + o.bald : 0;
  };

  const spalten: Tabellenspalte<Schulung>[] = [
    {
      schluessel: "bereich",
      titel: worte.schulungen.bereich,
      typ: "text",
      wert: (s) => s.bereich,
      zelle: (s) => <Badge variant="outline">{s.bereich}</Badge>,
    },
    {
      schluessel: "name",
      titel: worte.schulungen.schulung,
      typ: "text",
      wert: (s) => s.name,
      zelle: (s) => (
        <Link href={`/hr/schulungen/${s.id}`} className="font-medium underline-offset-4 hover:underline">
          {s.name}
        </Link>
      ),
    },
    {
      schluessel: "turnus",
      titel: worte.schulungen.turnus,
      typ: "text",
      wert: (s) => s.turnus,
      zelle: (s) => (
        <>
          {s.turnus ?? "—"}
          {s.turnus && s.turnus_monate === null && (
            <span className="ms-1 text-xs text-[var(--fg-muted)]">{worte.schulungen.nichtBerechenbar}</span>
          )}
        </>
      ),
    },
    {
      schluessel: "frist",
      titel: worte.schulungen.frist,
      typ: "zahl",
      suchtext: false,
      wert: (s) => s.frist_tage,
      zelle: (s) => (
        <Input
          className="w-20 tabular-nums"
          inputMode="numeric"
          defaultValue={s.frist_tage ?? ""}
          placeholder="—"
          aria-label={worte.schulungen.frist}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const roh = e.target.value.trim();
            const wert = roh === "" ? null : Number(roh);
            if (wert !== null && (!Number.isFinite(wert) || wert <= 0)) {
              toast.error(worte.schulungen.zahlGroesserNull);
              e.target.value = String(s.frist_tage ?? "");
              return;
            }
            if (wert !== s.frist_tage) aendern.mutate({ id: s.id, felder: { frist_tage: wert } });
          }}
        />
      ),
    },
    {
      schluessel: "verantwortlich",
      titel: worte.schulungen.verantwortlich,
      typ: "text",
      wert: (s) => s.verantwortlicher,
      zelle: (s) => (
        <Input
          defaultValue={s.verantwortlicher ?? ""}
          placeholder="—"
          aria-label={worte.schulungen.verantwortlich}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const wert = e.target.value.trim() || null;
            if (wert !== s.verantwortlicher) aendern.mutate({ id: s.id, felder: { verantwortlicher: wert } });
          }}
        />
      ),
    },
    {
      schluessel: "offen",
      titel: worte.schulungen.offen,
      typ: "zahl",
      suchtext: false,
      ausrichtung: "end",
      wert: (s) => offenSumme(s.id),
      zelle: (s) => {
        const o = offenNach.get(s.id);
        if (!o || o.nie + o.ueberfaellig + o.bald === 0) return "—";
        return (
          <span className="flex flex-wrap justify-end gap-2 tabular-nums">
            {o.nie > 0 && <span className="text-[var(--danger)]">{worte.schulungen.nieKurz(o.nie)}</span>}
            {o.ueberfaellig > 0 && <span className="text-[var(--danger)]">{worte.schulungen.ueberfaelligKurz(o.ueberfaellig)}</span>}
            {o.bald > 0 && <span>{worte.schulungen.baldKurz(o.bald)}</span>}
          </span>
        );
      },
    },
    {
      schluessel: "aktiv",
      titel: worte.schulungen.aktiv,
      typ: "zahl",
      sortierbar: false,
      suchtext: false,
      wert: (s) => Number(s.aktiv),
      zelle: (s) => (
        <Switch
          checked={s.aktiv}
          label={worte.schulungen.aktivSchalter(s.name)}
          disabled={!darfSchreiben}
          onCheckedChange={(aktiv) => aendern.mutate({ id: s.id, felder: { aktiv } })}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {darfSchreiben && (
        <Seitenwerkzeuge kategorie="aktionen">
          <div className="flex flex-col items-stretch gap-2">
            {/* In der Leiste trägt der Werkzeug-Titel die Beschriftung, sonst das Label. */}
            <Werkzeug titel={worte.schulungen.bereich}>
            <div className="flex flex-col gap-1">
              {!inSchale && <Label htmlFor="neu-bereich">{worte.schulungen.bereich}</Label>}
              <Input
                id="neu-bereich"
                aria-label={worte.schulungen.bereich}
                value={neu.bereich}
                list="bereiche"
                onChange={(e) => setNeu({ ...neu, bereich: e.target.value })}
              />
              <datalist id="bereiche">
                {bereiche.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            </Werkzeug>
            <Werkzeug titel={worte.schulungen.neueSchulung}>
            <div className="flex flex-col gap-1">
              {!inSchale && <Label htmlFor="neu-name">{worte.schulungen.neueSchulung}</Label>}
              <Input
                id="neu-name"
                aria-label={worte.schulungen.neueSchulung}
                value={neu.name}
                placeholder={worte.schulungen.beispiel}
                onChange={(e) => setNeu({ ...neu, name: e.target.value })}
              />
            </div>
            </Werkzeug>
            <Button disabled={!neu.name.trim() || !neu.bereich.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {worte.schulungen.anlegen}
            </Button>
            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)] focus-within:outline-2 focus-within:outline-[var(--ring)]">
              <FileUp className="me-1.5 h-4 w-4" aria-hidden />
              {zeigen.isPending ? worte.schulungen.wirdGelesen : worte.schulungen.uebersichtEinlesen}
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                aria-label={worte.schulungen.einlesenAria}
                disabled={zeigen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) zeigen.mutate(datei);
                }}
              />
            </label>
          </div>
        </Seitenwerkzeuge>
      )}

      {darfSchreiben && vorschau && (
        <Card className="p-4">
          <div className="space-y-2 rounded-md bg-[var(--muted)] p-4 text-sm">
            <p className="font-medium">{vorschau.ergebnis.dateiname}</p>
            <p>
              {worte.schulungen.vorschau(
                vorschau.ergebnis.schulungen,
                vorschau.ergebnis.schulungen_neu,
                vorschau.ergebnis.teilnahmen,
                vorschau.ergebnis.teilnahmen_zugeordnet,
              )}
            </p>
            {vorschau.ergebnis.nicht_zugeordnet.length > 0 && (
              <p className="text-[var(--fg-muted)]">
                {worte.schulungen.ohneTreffer}
                {vorschau.ergebnis.nicht_zugeordnet
                  .map((o) => `${o.mitarbeiter_name ?? o.personalnummer} (${o.teilnahmen})`)
                  .join(", ")}
                {worte.schulungen.ohneTrefferNach}
              </p>
            )}
            {vorschau.ergebnis.hinweise.slice(0, 5).map((h) => (
              <p key={h} className="text-[var(--fg-muted)]">
                {h}
              </p>
            ))}
            <div className="flex gap-2 pt-1">
              <Button disabled={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>
                {uebernehmen.isPending ? worte.schulungen.wirdUebernommen : worte.schulungen.uebernehmen}
              </Button>
              <Button variant="outline" onClick={() => setVorschau(null)}>
                {worte.schulungen.abbrechen}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Datentabelle
        zeilen={liste}
        spalten={spalten}
        zeilenSchluessel={(s) => s.id}
        laedt={katalog.isPending}
        leer={worte.schulungen.keineSchulungText}
        beschriftung={worte.schulungen.schulung}
        zeilenKlasse={(s) => cn(!s.aktiv && "opacity-60")}
      />

      <p className="text-sm text-[var(--fg-muted)]">
        {worte.schulungen.fussnote(
          dringlichkeitLabel.nie,
          dringlichkeitLabel.faellig_bald,
          stand.data?.length ? DATUM.format(new Date()) : "—",
        )}
      </p>
    </div>
  );
}
