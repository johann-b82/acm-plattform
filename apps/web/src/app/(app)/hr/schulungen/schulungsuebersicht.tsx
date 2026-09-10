"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Plus } from "lucide-react";

import {
  DRINGLICHKEIT_LABEL,
  dringlichkeit,
  schulungApi,
  schulungKeys,
  type ImportErgebnis,
  type Schulung,
} from "@/lib/schulungen";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Switch,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * Der Schulungskatalog und was daran offen ist.
 *
 * „Fällig" steht nirgends gespeichert — die Sicht rechnet es aus letztem
 * Termin und Turnus. Wer den Turnus ändert, sieht die Wirkung sofort; im
 * Altprojekt bliebe die beim Import berechnete Spalte stehen.
 */
export function Schulungsuebersicht({ darfSchreiben }: { darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState({ bereich: "betrieblich", name: "" });
  const [vorschau, setVorschau] = useState<{ datei: File; ergebnis: ImportErgebnis } | null>(
    null,
  );

  const katalog = useQuery({ queryKey: schulungKeys.katalog(), queryFn: schulungApi.katalog });
  const stand = useQuery({ queryKey: schulungKeys.stand(), queryFn: schulungApi.stand });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["schulungen"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const zeigen = useMutation({
    mutationFn: (datei: File) =>
      schulungApi.vorschau(datei).then((ergebnis) => ({ datei, ergebnis })),
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
      toast.error(
        /duplicate|unique/i.test(fehler.message)
          ? "Diese Schulung gibt es in dem Bereich schon."
          : fehler.message,
      ),
  });

  const aendern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Partial<Schulung> }) =>
      schulungApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  // Die Rohdaten als Abhängigkeit, der Fallback erst innen.
  const katalogDaten = katalog.data;
  const liste = useMemo(() => katalogDaten ?? [], [katalogDaten]);

  /** Je Schulung: wie viele Teilnahmen sind offen, und wie dringend. */
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

  const bereiche = useMemo(
    () => [...new Set(liste.map((s) => s.bereich))],
    [liste],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schulungen</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Der Katalog, sein Turnus und wer ihn erfüllt. Fälligkeiten werden
            aus letztem Termin und Turnus gerechnet, nicht gespeichert.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/hr/schulungen/offen" className="underline-offset-4 hover:underline">
            Was offen ist
          </Link>
          <Link href="/hr" className="underline-offset-4 hover:underline">
            Personal
          </Link>
        </div>
      </div>

      {darfSchreiben && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bereich">Bereich</Label>
              <Input
                id="bereich"
                className="w-40"
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
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="name">Neue Schulung</Label>
              <Input
                id="name"
                value={neu.name}
                placeholder="z. B. Brandschutzunterweisung"
                onChange={(e) => setNeu({ ...neu, name: e.target.value })}
              />
            </div>
            <Button
              disabled={!neu.name.trim() || !neu.bereich.trim() || anlegen.isPending}
              onClick={() => anlegen.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Anlegen
            </Button>
            <label
              className={
                "inline-flex h-9 cursor-pointer items-center rounded-md border " +
                "border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)] " +
                "focus-within:outline-2 focus-within:outline-[var(--ring)]"
              }
            >
              <FileUp className="mr-1.5 h-4 w-4" aria-hidden />
              {zeigen.isPending ? "Wird gelesen …" : "Übersicht einlesen"}
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                aria-label="Schulungsübersicht einlesen"
                disabled={zeigen.isPending}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  e.target.value = "";
                  if (datei) zeigen.mutate(datei);
                }}
              />
            </label>
          </div>

          {vorschau && (
            <div className="space-y-2 rounded-md bg-[var(--muted)] p-4 text-sm">
              <p className="font-medium">{vorschau.ergebnis.dateiname}</p>
              <p>
                {vorschau.ergebnis.schulungen} Schulungen (
                {vorschau.ergebnis.schulungen_neu} neu),{" "}
                {vorschau.ergebnis.teilnahmen} Teilnahmen, davon{" "}
                {vorschau.ergebnis.teilnahmen_zugeordnet} einer Person in Personio
                zugeordnet.
              </p>
              {vorschau.ergebnis.nicht_zugeordnet.length > 0 && (
                <p className="text-[var(--fg-muted)]">
                  Ohne Personio-Treffer:{" "}
                  {vorschau.ergebnis.nicht_zugeordnet
                    .map((o) => `${o.mitarbeiter_name ?? o.personalnummer} (${o.teilnahmen})`)
                    .join(", ")}
                  . Diese Zeilen kommen mit Personalnummer und Namen trotzdem mit.
                </p>
              )}
              {vorschau.ergebnis.hinweise.slice(0, 5).map((h) => (
                <p key={h} className="text-[var(--fg-muted)]">
                  {h}
                </p>
              ))}
              <div className="flex gap-2 pt-1">
                <Button disabled={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>
                  {uebernehmen.isPending ? "Wird übernommen …" : "Übernehmen"}
                </Button>
                <Button variant="outline" onClick={() => setVorschau(null)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {katalog.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title="Noch keine Schulung"
          body="Leg eine an oder lies die Schulungsübersicht ein."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Bereich</Th>
                <Th>Schulung</Th>
                <Th>Turnus</Th>
                <Th>Frist (Tage)</Th>
                <Th>Verantwortlich</Th>
                <Th>Offen</Th>
                <Th>Aktiv</Th>
              </tr>
            </thead>
            <tbody>
              {liste.map((s) => {
                const offen = offenNach.get(s.id);
                return (
                  <tr key={s.id} className={cn(!s.aktiv && "opacity-60")}>
                    <Td>
                      <Badge variant="outline">{s.bereich}</Badge>
                    </Td>
                    <Td>
                      <Link
                        href={`/hr/schulungen/${s.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {s.name}
                      </Link>
                    </Td>
                    <Td>
                      {s.turnus ?? "—"}
                      {s.turnus && s.turnus_monate === null && (
                        <span className="ml-1 text-xs text-[var(--fg-muted)]">
                          (nicht berechenbar)
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Input
                        className="w-20 tabular-nums"
                        inputMode="numeric"
                        defaultValue={s.frist_tage ?? ""}
                        placeholder="—"
                        disabled={!darfSchreiben}
                        onBlur={(e) => {
                          const roh = e.target.value.trim();
                          const wert = roh === "" ? null : Number(roh);
                          if (wert !== null && (!Number.isFinite(wert) || wert <= 0)) {
                            toast.error("Bitte eine Zahl größer als 0.");
                            e.target.value = String(s.frist_tage ?? "");
                            return;
                          }
                          if (wert !== s.frist_tage) {
                            aendern.mutate({ id: s.id, felder: { frist_tage: wert } });
                          }
                        }}
                      />
                    </Td>
                    <Td>
                      <Input
                        defaultValue={s.verantwortlicher ?? ""}
                        placeholder="—"
                        disabled={!darfSchreiben}
                        onBlur={(e) => {
                          const wert = e.target.value.trim() || null;
                          if (wert !== s.verantwortlicher) {
                            aendern.mutate({ id: s.id, felder: { verantwortlicher: wert } });
                          }
                        }}
                      />
                    </Td>
                    <Td className="tabular-nums">
                      {offen ? (
                        <span className="flex flex-wrap gap-2">
                          {offen.nie > 0 && (
                            <span className="text-[var(--danger)]">{offen.nie} nie</span>
                          )}
                          {offen.ueberfaellig > 0 && (
                            <span className="text-[var(--danger)]">
                              {offen.ueberfaellig} überfällig
                            </span>
                          )}
                          {offen.bald > 0 && <span>{offen.bald} bald</span>}
                          {offen.nie + offen.ueberfaellig + offen.bald === 0 && "—"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <Switch
                        checked={s.aktiv}
                        label={`${s.name} aktiv`}
                        disabled={!darfSchreiben}
                        onCheckedChange={(aktiv) =>
                          aendern.mutate({ id: s.id, felder: { aktiv } })
                        }
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <p className="text-sm text-[var(--fg-muted)]">
        {DRINGLICHKEIT_LABEL.nie} heißt: für diese Person steht kein Termin in
        der Historie. {DRINGLICHKEIT_LABEL.faellig_bald} heißt: innerhalb der
        nächsten zwei Monate. Stand vom{" "}
        {stand.data?.length ? DATUM.format(new Date()) : "—"}.
      </p>
    </div>
  );
}
