"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileDown, Plus } from "lucide-react";

import {
  istNeu,
  onboardingApi,
  onboardingKeys,
  type Eintritt,
  type Planzeile,
} from "@/lib/onboarding";
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
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHE_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";



const LEER = { name: "", abteilung: "", position: "", eintritt: "" };

/**
 * Die Eintritte und ihr Schulungsplan.
 *
 * Der Plan kommt aus der Datenbank: `schulungsplan(employee_id)` verbindet
 * Anforderungsmatrix, Rollenzuordnung und Bestand. Fehlt die Zuordnung
 * Position → Abteilungskürzel, meldet die Funktion das als eigene Zeile —
 * ohne diesen Hinweis entstünden unbemerkt zu wenige Pflichtschulungen.
 */
export function Eintritte({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const DATUM = new Intl.DateTimeFormat(SPRACHE_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState<number | null>(null);
  const [neu, setNeu] = useState({ ...LEER });
  const [neueRolle, setNeueRolle] = useState({ position: "", kuerzel: "" });
  const [nurNeue, setNurNeue] = useState(true);

  const eintritte = useQuery({
    queryKey: onboardingKeys.eintritte(),
    queryFn: onboardingApi.eintritte,
  });
  const rollen = useQuery({ queryKey: onboardingKeys.rollen(), queryFn: onboardingApi.rollen });
  const plan = useQuery({
    queryKey: onboardingKeys.plan(offen ?? 0),
    queryFn: () => onboardingApi.plan(offen!),
    enabled: offen !== null,
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const planAnlegen = useMutation({
    mutationFn: (employee_id: number) => onboardingApi.planAnlegen(employee_id),
    onSuccess: (anzahl) => {
      toast.success(
        anzahl === 0
          ? worte.onboarding.nichtsGefehlt
          : worte.onboarding.angelegt(anzahl),
      );
      queryClient.invalidateQueries({ queryKey: ["schulungen"] });
      return neuLaden();
    },
    onError: melde,
  });

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

  const rolleSetzen = useMutation({
    mutationFn: () =>
      onboardingApi.rolleSetzen(neueRolle.position.trim(), neueRolle.kuerzel.trim()),
    onSuccess: () => {
      setNeueRolle({ position: "", kuerzel: "" });
      return neuLaden();
    },
    onError: melde,
  });

  const rolleWeg = useMutation({
    mutationFn: (id: string) => onboardingApi.rolleLoeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const liste = useMemo(() => {
    const alle = eintritte.data ?? [];
    return nurNeue ? alle.filter((e) => istNeu(e)) : alle;
  }, [eintritte.data, nurNeue]);

  return (
    <div className="space-y-6">
      <Seitenkopf
        titel={worte.pfad.seiten["/hr/onboarding"]}
        untertitel={worte.onboarding.einleitung}
        unter={
          <div className="mt-2 flex justify-center gap-4 text-sm">
            <Link href="/hr/dokumente" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/dokumente"]}
            </Link>
            <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/schulungen"]}
            </Link>
          </div>
        }
      />

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Button
          size="sm"
          variant={nurNeue ? "default" : "outline"}
          onClick={() => setNurNeue(true)}
        >
          {worte.onboarding.neu90}
        </Button>
        <Button
          size="sm"
          variant={nurNeue ? "outline" : "default"}
          onClick={() => setNurNeue(false)}
        >
          {worte.onboarding.alle}
        </Button>
        <span className="text-sm text-[var(--fg-muted)]">
          {worte.onboarding.personen(liste.length)}
        </span>
      </Card>

      {eintritte.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title={worte.onboarding.keineEintritte}
          body={worte.onboarding.keineEintritteText}
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.onboarding.person}</Th>
                <Th>{worte.onboarding.abteilung}</Th>
                <Th>{worte.onboarding.position}</Th>
                <Th>{worte.onboarding.eintritt}</Th>
                <Th>{worte.onboarding.uebergabe}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {liste.map((e) => (
                <tr key={e.employee_id ?? e.extern_id}>
                  <Td>
                    {e.name}
                    {e.extern_id && (
                      <Badge variant="outline" className="ml-2">
                        {worte.onboarding.nichtInPersonio}
                      </Badge>
                    )}
                    {istNeu(e) && <Badge className="ml-2">neu</Badge>}
                  </Td>
                  <Td>
                    {e.employee_id !== null ? (
                      <Input
                        defaultValue={e.abteilung ?? ""}
                        placeholder="—"
                        disabled={!darfSchreiben}
                        title={
                          e.abteilung_gesetzt
                            ? worte.onboarding.hierGesetzt
                            : worte.onboarding.ausPersonio
                        }
                        onBlur={(ev) => {
                          const wert = ev.target.value.trim() || null;
                          if (wert !== (e.abteilung ?? null)) {
                            abteilung.mutate({ employee_id: e.employee_id!, abteilung: wert });
                          }
                        }}
                      />
                    ) : (
                      (e.abteilung ?? "—")
                    )}
                  </Td>
                  <Td>{e.position ?? "—"}</Td>
                  <Td>{e.eintritt ? DATUM.format(new Date(e.eintritt)) : "—"}</Td>
                  <Td>
                    {e.heruntergeladen_am ? (
                      DATUM.format(new Date(e.heruntergeladen_am))
                    ) : darfSchreiben ? (
                      <Button size="sm" variant="outline" onClick={() => paket.mutate(e)}>
                        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {worte.onboarding.vermerken}
                      </Button>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        title={worte.onboarding.paketTitel}
                        disabled={paketDrucken.isPending}
                        onClick={() => paketDrucken.mutate(e)}
                      >
                        <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
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
                          onClick={() =>
                            setOffen(offen === e.employee_id ? null : e.employee_id)
                          }
                        >
                          {offen === e.employee_id ? worte.onboarding.planZu : worte.onboarding.plan}
                        </Button>
                      ) : (
                        darfSchreiben && (
                          <ConfirmDeleteButton
                            itemLabel={e.name}
                            onConfirm={() =>
                              externWeg.mutateAsync(e.extern_id!).then(() => undefined)
                            }
                          />
                        )
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {offen !== null && (
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">{worte.onboarding.schulungsplan}</h2>
            {darfSchreiben && (
              <Button
                disabled={planAnlegen.isPending}
                onClick={() => planAnlegen.mutate(offen)}
              >
                {worte.onboarding.fehlendeAnlegen}
              </Button>
            )}
          </div>
          {plan.isLoading ? (
            <p className="text-sm text-[var(--fg-muted)]">{worte.onboarding.wirdGerechnet}</p>
          ) : (
            <Planliste zeilen={plan.data ?? []} />
          )}
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-medium">{worte.onboarding.bruecke}</h2>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            {worte.onboarding.brueckeHinweis}
          </p>
        </div>
        {(rollen.data ?? []).length > 0 && (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {(rollen.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span>{r.position}</span>
                <Badge variant="outline">{r.abteilung_kuerzel}</Badge>
                {darfSchreiben && (
                  <span className="ml-auto">
                    <ConfirmDeleteButton
                      itemLabel={r.position}
                      onConfirm={() => rolleWeg.mutateAsync(r.id).then(() => undefined)}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {darfSchreiben && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="position">{worte.onboarding.position}</Label>
              <Input
                id="position"
                value={neueRolle.position}
                placeholder={worte.onboarding.positionBeispiel}
                onChange={(e) => setNeueRolle({ ...neueRolle, position: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kuerzel">{worte.onboarding.kuerzel}</Label>
              <Input
                id="kuerzel"
                className="w-28"
                value={neueRolle.kuerzel}
                placeholder={worte.onboarding.kuerzelBeispiel}
                onChange={(e) => setNeueRolle({ ...neueRolle, kuerzel: e.target.value })}
              />
            </div>
            <Button
              variant="outline"
              disabled={!neueRolle.position.trim() || !neueRolle.kuerzel.trim()}
              onClick={() => rolleSetzen.mutate()}
            >
              {worte.onboarding.zuordnen}
            </Button>
          </div>
        )}
      </Card>

      {darfSchreiben && (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="font-medium">{worte.onboarding.ohnePersonio}</h2>
            <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
              {worte.onboarding.ohnePersonioHinweis}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <Label htmlFor="extern-name">{worte.onboarding.name}</Label>
              <Input
                id="extern-name"
                value={neu.name}
                onChange={(e) => setNeu({ ...neu, name: e.target.value })}
              />
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
            <Button
              disabled={!neu.name.trim() || externAnlegen.isPending}
              onClick={() => externAnlegen.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {worte.onboarding.anlegen}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Soll und Ist nebeneinander — samt dem Hinweis, wenn eine Ebene nicht greift. */
function Planliste({ zeilen }: { zeilen: Planzeile[] }) {
  const worte = useTexte();
  const hinweis = zeilen.find((z) => z.quelle === "kuerzel_fehlt");
  const echte = zeilen.filter((z) => z.quelle !== "kuerzel_fehlt");

  return (
    <div className="space-y-3">
      {hinweis && (
        <p className="rounded-md bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-3 text-sm">
          {worte.onboarding.kuerzelFehlt(hinweis.abteilung ? `„${hinweis.abteilung}“ ` : "")}
        </p>
      )}
      {echte.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">
          {worte.onboarding.matrixVerlangtNichts}
        </p>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.onboarding.schulung}</Th>
                <Th>{worte.onboarding.bereich}</Th>
                <Th>{worte.onboarding.turnus}</Th>
                <Th>{worte.onboarding.pflichtUeber}</Th>
                <Th>{worte.onboarding.stand}</Th>
              </tr>
            </thead>
            <tbody>
              {echte.map((z) => (
                <tr key={`${z.schulung_id}-${z.quelle}`}>
                  <Td>{z.name}</Td>
                  <Td>{z.bereich}</Td>
                  <Td>{z.turnus ?? "—"}</Td>
                  <Td>
                    <Badge variant="outline">
                      {z.quelle === "personio"
                        ? worte.onboarding.ueberAbteilung
                        : worte.onboarding.ueberKuerzel}{" "}
                      {z.abteilung}
                    </Badge>
                  </Td>
                  <Td>
                    {z.vorhanden ? (
                      <Badge variant="secondary">{worte.onboarding.vorhanden}</Badge>
                    ) : (
                      <Badge>{worte.onboarding.fehlt}</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
