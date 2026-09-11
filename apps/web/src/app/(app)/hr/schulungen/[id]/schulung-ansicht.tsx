"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import {
  dringlichkeit,
  schulungApi,
  schulungKeys,
  type Pflicht,
  type Schulung,
  type Stand,
  type Teilnahme,
} from "@/lib/schulungen";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Table,
  TableWrap,
  Td,
  Textarea,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { useDringlichkeit } from "@/lib/tafeln";



const EBENEN: { wert: Pflicht["ebene"]; wort: "kuerzel" | "personioAbteilung" }[] = [
  { wert: "kuerzel", wort: "kuerzel" },
  { wert: "personio", wort: "personioAbteilung" },
];

export function SchulungAnsicht({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const worte = useTexte();
  const dringlichkeitLabel = useDringlichkeit();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState("");
  const [neuePflicht, setNeuePflicht] = useState<Record<string, string>>({});

  const katalog = useQuery({ queryKey: schulungKeys.katalog(), queryFn: schulungApi.katalog });
  const teilnahmen = useQuery({
    queryKey: schulungKeys.teilnahmen(id),
    queryFn: () => schulungApi.teilnahmen(id),
  });
  const stand = useQuery({ queryKey: schulungKeys.stand(), queryFn: schulungApi.stand });
  const pflicht = useQuery({ queryKey: schulungKeys.pflicht(), queryFn: schulungApi.pflicht });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["schulungen"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const aendern = useMutation({
    mutationFn: (felder: Partial<Schulung>) => schulungApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const teilnahmeAendern = useMutation({
    mutationFn: ({ t, felder }: { t: Teilnahme; felder: Partial<Teilnahme> }) =>
      schulungApi.teilnahmeAendern(t.id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const teilnahmeAnlegen = useMutation({
    mutationFn: () => schulungApi.teilnahmeAnlegen(id, neu.trim(), null),
    onSuccess: () => {
      setNeu("");
      return neuLaden();
    },
    onError: melde,
  });

  const teilnahmeWeg = useMutation({
    mutationFn: (t: Teilnahme) => schulungApi.teilnahmeLoeschen(t.id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const pflichtSetzen = useMutation({
    mutationFn: (w: { ebene: Pflicht["ebene"]; abteilung: string; an: boolean }) =>
      schulungApi.pflichtSetzen(id, w.ebene, w.abteilung, w.an),
    onSuccess: (_d, w) => {
      setNeuePflicht((s) => ({ ...s, [w.ebene]: "" }));
      return neuLaden();
    },
    onError: melde,
  });

  const schulung = (katalog.data ?? []).find((s) => s.id === id);
  const meineTeilnahmen = teilnahmen.data ?? [];
  const standNach = useMemo(() => {
    const m = new Map<string, Stand>();
    for (const s of stand.data ?? []) m.set(s.teilnahme_id, s);
    return m;
  }, [stand.data]);
  const meinePflichten = (pflicht.data ?? []).filter((p) => p.schulung_id === id);

  if (katalog.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>;
  }
  if (!schulung) {
    return <EmptyState title={worte.schulung.gibtEsNicht} body={worte.schulung.gibtEsNichtText} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{schulung.name}</h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            <Badge variant="outline">{schulung.bereich}</Badge>{" "}
            {schulung.turnus ?? worte.schulung.ohneTurnus}
            {schulung.turnus &&
              schulung.turnus_monate === null &&
              worte.schulung.keineFaelligkeit}
          </p>
        </div>
        <Link href="/hr/schulungen" className="text-sm underline-offset-4 hover:underline">
          {worte.schulung.zumKatalog}
        </Link>
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">{worte.schulung.stammdaten}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="turnus">{worte.schulung.turnus}</Label>
            <Input
              id="turnus"
              defaultValue={schulung.turnus ?? ""}
              placeholder={worte.schulung.turnusBeispiel}
              disabled={!darfSchreiben}
              onBlur={(e) => {
                const wert = e.target.value.trim() || null;
                if (wert !== schulung.turnus) aendern.mutate({ turnus: wert });
              }}
            />
            <span className="text-xs text-[var(--fg-muted)]">
              {worte.schulung.turnusHinweis}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="monate">{worte.schulung.turnusMonate}</Label>
            <Input
              id="monate"
              className="tabular-nums"
              inputMode="numeric"
              defaultValue={schulung.turnus_monate ?? ""}
              placeholder="—"
              disabled={!darfSchreiben}
              onBlur={(e) => {
                const roh = e.target.value.trim();
                const wert = roh === "" ? null : Number(roh);
                if (wert !== null && (!Number.isFinite(wert) || wert <= 0)) {
                  toast.error(worte.schulungen.zahlGroesserNull);
                  e.target.value = String(schulung.turnus_monate ?? "");
                  return;
                }
                if (wert !== schulung.turnus_monate) {
                  aendern.mutate({ turnus_monate: wert });
                }
              }}
            />
            <span className="text-xs text-[var(--fg-muted)]">
              {worte.schulung.monateHinweis}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="verantwortlicher">{worte.schulung.verantwortlich}</Label>
            <Input
              id="verantwortlicher"
              defaultValue={schulung.verantwortlicher ?? ""}
              placeholder="—"
              disabled={!darfSchreiben}
              onBlur={(e) => {
                const wert = e.target.value.trim() || null;
                if (wert !== schulung.verantwortlicher) {
                  aendern.mutate({ verantwortlicher: wert });
                }
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="beschreibung">{worte.schulung.beschreibung}</Label>
          <Textarea
            id="beschreibung"
            rows={3}
            defaultValue={schulung.beschreibung ?? ""}
            disabled={!darfSchreiben}
            onBlur={(e) => {
              const wert = e.target.value.trim() || null;
              if (wert !== schulung.beschreibung) aendern.mutate({ beschreibung: wert });
            }}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">{worte.schulung.fuerWen}</h2>
        {EBENEN.map((ebene) => {
          const gesetzt = meinePflichten.filter((p) => p.ebene === ebene.wert);
          return (
            <div key={ebene.wert} className="space-y-2">
              <div>
                <h3 className="text-sm font-medium">{worte.schulung[ebene.wort]}</h3>
                <p className="text-xs text-[var(--fg-muted)]">
                  {ebene.wort === "kuerzel"
                    ? worte.schulung.kuerzelHinweis
                    : worte.schulung.personioHinweis}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {gesetzt.map((p) => (
                  <Badge key={p.id} variant="secondary">
                    {p.abteilung}
                    {darfSchreiben && (
                      <button
                        type="button"
                        className="ms-1.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                        aria-label={worte.schulung.entfernen(p.abteilung)}
                        onClick={() =>
                          pflichtSetzen.mutate({
                            ebene: ebene.wert,
                            abteilung: p.abteilung,
                            an: false,
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
                {gesetzt.length === 0 && (
                  <span className="text-sm text-[var(--fg-muted)]">{worte.schulung.keine}</span>
                )}
              </div>
              {darfSchreiben && (
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    className="w-48"
                    value={neuePflicht[ebene.wert] ?? ""}
                    placeholder={ebene.wert === "kuerzel" ? "NÄH" : "Production"}
                    aria-label={worte.schulung.ergaenzen(worte.schulung[ebene.wort])}
                    onChange={(e) =>
                      setNeuePflicht((s) => ({ ...s, [ebene.wert]: e.target.value }))
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!(neuePflicht[ebene.wert] ?? "").trim()}
                    onClick={() =>
                      pflichtSetzen.mutate({
                        ebene: ebene.wert,
                        abteilung: (neuePflicht[ebene.wert] ?? "").trim(),
                        an: true,
                      })
                    }
                  >
                    {worte.schulung.hinzufuegen}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">{worte.schulung.teilnahmen}</h2>
        {meineTeilnahmen.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.schulung.nochNiemand}
          </p>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{worte.schulung.person}</Th>
                  <Th>{worte.schulung.abteilungKurz}</Th>
                  <Th>{worte.schulung.erstschulung}</Th>
                  <Th>{worte.schulung.zuletzt}</Th>
                  <Th>{worte.schulung.faellig}</Th>
                  <Th>{worte.schulung.stand}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {meineTeilnahmen.map((t) => {
                  const s = standNach.get(t.id);
                  const d = s ? dringlichkeit(s) : null;
                  return (
                    <tr key={t.id}>
                      <Td>
                        {t.mitarbeiter_name ?? t.personalnummer ?? "—"}
                        {t.employee_id === null && (
                          <span
                            className="ms-2 text-xs text-[var(--fg-muted)]"
                            title={worte.schulung.keinTreffer}
                          >
                            {worte.schulung.nichtInPersonio}
                          </span>
                        )}
                      </Td>
                      <Td>{t.abteilung_kuerzel ?? "—"}</Td>
                      <Td>
                        <Input
                          type="date"
                          defaultValue={t.initial_datum ?? ""}
                          disabled={!darfSchreiben}
                          onBlur={(e) => {
                            const wert = e.target.value || null;
                            if (wert !== t.initial_datum) {
                              teilnahmeAendern.mutate({ t, felder: { initial_datum: wert } });
                            }
                          }}
                        />
                      </Td>
                      <Td>
                        <Input
                          type="date"
                          defaultValue={t.aktuell_datum ?? ""}
                          disabled={!darfSchreiben}
                          onBlur={(e) => {
                            const wert = e.target.value || null;
                            if (wert !== t.aktuell_datum) {
                              teilnahmeAendern.mutate({ t, felder: { aktuell_datum: wert } });
                            }
                          }}
                        />
                      </Td>
                      <Td>
                        {s?.faellig_am ? DATUM.format(new Date(s.faellig_am)) : "—"}
                        {t.naechste_faellig && (
                          <span className="ms-2 text-xs text-[var(--fg-muted)]">
                            {worte.schulung.exzel(t.naechste_faellig)}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {d && (
                          <Badge variant={d === "offen" ? "outline" : "secondary"}>
                            {dringlichkeitLabel[d]}
                          </Badge>
                        )}
                      </Td>
                      <Td className="text-end">
                        {darfSchreiben && (
                          <ConfirmDeleteButton
                            itemLabel={t.mitarbeiter_name ?? worte.schulung.dieseTeilnahme}
                            onConfirm={() => teilnahmeWeg.mutateAsync(t).then(() => undefined)}
                          />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}

        {darfSchreiben && (
          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="neue-teilnahme">{worte.schulung.personErgaenzen}</Label>
              <Input
                id="neue-teilnahme"
                value={neu}
                placeholder={worte.schulung.nameForm}
                onChange={(e) => setNeu(e.target.value)}
              />
            </div>
            <Button
              disabled={!neu.trim() || teilnahmeAnlegen.isPending}
              onClick={() => teilnahmeAnlegen.mutate()}
            >
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {worte.schulung.hinzufuegen}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
