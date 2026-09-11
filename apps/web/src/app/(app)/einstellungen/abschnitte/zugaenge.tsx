"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, KeyRound, Pencil, UserPlus, X } from "lucide-react";

import {
  LEVEL_LABEL,
  verwaltungApi,
  verwaltungKeys,
  type App,
  type Gruppe,
  type Mitgliedschaft,
  type Nutzer,
  type Recht,
} from "@/lib/verwaltung";
import { LEVELS, type Level } from "@/lib/rechte";
import { feedbackApi, feedbackKeys } from "@/lib/feedback";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
} from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Gruppen, Mitglieder und App-Rechte pflegen.
 *
 * Steht als Gruppe in den Einstellungen, nicht mehr auf einer eigenen Seite:
 * wer Rechte vergibt, stellt etwas ein. Die Überschrift kommt deshalb von der
 * Einstellungsseite, hier beginnt es mit dem, was man tun kann.
 *
 * Das Modell trägt bereits die spätere Verzeichnis-Anbindung: Gruppen mit
 * Quelle „ad“ werden hier nicht bearbeitet, ihre Mitglieder kommen dann aus
 * dem Verzeichnis. Die App-Rechte bleiben in jedem Fall hier.
 */
export function Zugaenge({ eigeneId }: { eigeneId: string }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [neueGruppe, setNeueGruppe] = useState("");
  const [umbenennen, setUmbenennen] = useState<{ gruppe: Gruppe; name: string } | null>(null);
  const [mitglieder, setMitglieder] = useState<Gruppe | null>(null);
  const [neuesMitglied, setNeuesMitglied] = useState("");
  const [neueEmail, setNeueEmail] = useState("");
  const [zugang, setZugang] = useState<{ titel: string; email: string; passwort: string } | null>(
    null,
  );

  // Nur die Zahl der noch nicht angesehenen Meldungen — gezählt wird in der
  // Datenbank, die Liste selbst holt die eigene Seite.
  const meldungen = useQuery({
    queryKey: feedbackKeys.offen(),
    queryFn: feedbackApi.ungeseheneAnzahl,
  });
  const ungesehene = meldungen.data ?? 0;

  const [apps, gruppen, rechte, mitgliedschaften, nutzer] = useQueries({
    queries: [
      { queryKey: verwaltungKeys.apps(), queryFn: verwaltungApi.apps },
      { queryKey: verwaltungKeys.gruppen(), queryFn: verwaltungApi.gruppen },
      { queryKey: verwaltungKeys.rechte(), queryFn: verwaltungApi.rechte },
      { queryKey: verwaltungKeys.mitgliedschaften(), queryFn: verwaltungApi.mitgliedschaften },
      { queryKey: verwaltungKeys.nutzer(), queryFn: verwaltungApi.nutzer },
    ],
  });

  // `?? []` würde bei jedem Rendern ein neues Array erzeugen und die
  // Abhängigkeiten der useMemo-Aufrufe unbrauchbar machen — deshalb die
  // Rohdaten als Abhängigkeit und der Fallback erst innen.
  const appDaten = apps.data as App[] | undefined;
  const gruppenDaten = gruppen.data as Gruppe[] | undefined;
  const rechteDaten = rechte.data as Recht[] | undefined;
  const mitgliedDaten = mitgliedschaften.data as Mitgliedschaft[] | undefined;
  const nutzerDaten = nutzer.data as Nutzer[] | undefined;

  const appListe = useMemo(() => appDaten ?? [], [appDaten]);
  const gruppenListe = useMemo(() => gruppenDaten ?? [], [gruppenDaten]);
  const nutzerListe = useMemo(() => nutzerDaten ?? [], [nutzerDaten]);

  const rechtVon = useMemo(() => {
    const m = new Map<string, Level>();
    for (const r of rechteDaten ?? []) m.set(`${r.group_id}|${r.app_id}`, r.level);
    return m;
  }, [rechteDaten]);

  const mitgliederVon = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const z of mitgliedDaten ?? []) {
      const liste = m.get(z.group_id) ?? [];
      liste.push(z.user_id);
      m.set(z.group_id, liste);
    }
    return m;
  }, [mitgliedDaten]);

  const nutzerNach = useMemo(() => new Map(nutzerListe.map((n) => [n.id, n])), [nutzerListe]);

  function neuLaden(...keys: readonly (readonly unknown[])[]) {
    for (const key of keys) queryClient.invalidateQueries({ queryKey: key });
  }

  const anlegen = useMutation({
    mutationFn: () => verwaltungApi.gruppeAnlegen(neueGruppe.trim()),
    onSuccess: () => {
      setNeueGruppe("");
      neuLaden(verwaltungKeys.gruppen());
      toast.success(worte.zugaenge.gruppeAngelegt);
    },
    onError: (err: Error) =>
      toast.error(
        /duplicate|unique/i.test(err.message)
          ? worte.zugaenge.gruppeGibtEsSchon
          : `Anlegen fehlgeschlagen: ${err.message}`,
      ),
  });

  const nutzerAnlegen = useMutation({
    mutationFn: () => verwaltungApi.nutzerAnlegen(neueEmail.trim()),
    onSuccess: (nutzer) => {
      setNeueEmail("");
      setZugang({
        titel: worte.zugaenge.personAngelegt,
        email: nutzer.email,
        passwort: nutzer.passwort,
      });
      neuLaden(verwaltungKeys.nutzer());
    },
    onError: (err: Error) => toast.error(`Anlegen fehlgeschlagen: ${err.message}`),
  });

  const umbenennenMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      verwaltungApi.gruppeUmbenennen(id, name),
    onSuccess: () => {
      setUmbenennen(null);
      neuLaden(verwaltungKeys.gruppen());
      toast.success(worte.zugaenge.gruppeUmbenannt);
    },
    onError: (err: Error) => toast.error(`Umbenennen fehlgeschlagen: ${err.message}`),
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => verwaltungApi.gruppeLoeschen(id),
    onSuccess: () => {
      neuLaden(verwaltungKeys.gruppen(), verwaltungKeys.rechte(), verwaltungKeys.mitgliedschaften());
      toast.success(worte.zugaenge.gruppeGeloescht);
    },
    onError: (err: Error) => toast.error(`Löschen fehlgeschlagen: ${err.message}`),
  });

  const rechtSetzen = useMutation({
    mutationFn: ({ group_id, app_id, level }: { group_id: string; app_id: string; level: Level | null }) =>
      verwaltungApi.rechtSetzen(group_id, app_id, level),
    onSuccess: () => neuLaden(verwaltungKeys.rechte()),
    onError: (err: Error) => {
      neuLaden(verwaltungKeys.rechte());
      toast.error(`Recht konnte nicht gesetzt werden: ${err.message}`);
    },
  });

  const mitgliedHinzu = useMutation({
    mutationFn: ({ group_id, user_id }: { group_id: string; user_id: string }) =>
      verwaltungApi.mitgliedHinzufuegen(group_id, user_id),
    onSuccess: () => {
      setNeuesMitglied("");
      neuLaden(verwaltungKeys.mitgliedschaften());
      toast.success(worte.zugaenge.mitgliedHinzu);
    },
    onError: (err: Error) =>
      toast.error(
        /duplicate|unique/i.test(err.message)
          ? worte.zugaenge.schonInGruppe
          : `Hinzufügen fehlgeschlagen: ${err.message}`,
      ),
  });

  const passwortNeu = useMutation({
    mutationFn: (user_id: string) => verwaltungApi.passwortZuruecksetzen(user_id),
    onSuccess: (antwort, user_id) =>
      setZugang({
        titel: worte.zugaenge.neuesPasswort,
        email: nutzerNach.get(user_id)?.email ?? user_id,
        passwort: antwort.passwort,
      }),
    onError: (err: Error) => toast.error(`Zurücksetzen fehlgeschlagen: ${err.message}`),
  });

  const mitgliedWeg = useMutation({
    mutationFn: ({ group_id, user_id }: { group_id: string; user_id: string }) =>
      verwaltungApi.mitgliedEntfernen(group_id, user_id),
    onSuccess: () => {
      neuLaden(verwaltungKeys.mitgliedschaften());
      toast.success(worte.zugaenge.mitgliedEntfernt);
    },
    onError: (err: Error) => toast.error(`Entfernen fehlgeschlagen: ${err.message}`),
  });

  const laedt = apps.isLoading || gruppen.isLoading;
  const fehler = apps.error ?? gruppen.error ?? rechte.error ?? nutzer.error;

  const mitgliederDerGruppe = mitglieder ? (mitgliederVon.get(mitglieder.id) ?? []) : [];
  const nochNichtMitglied = nutzerListe.filter((n) => !mitgliederDerGruppe.includes(n.id));

  return (
    <div className="space-y-4">
      <Link
        href="/platform/feedback"
        className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline"
      >
        {worte.zugaenge.gemeldeteSeiten}
        {ungesehene > 0 && <Badge>{ungesehene}</Badge>}
      </Link>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Verwaltungsdaten konnten nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="neue-gruppe">{worte.zugaenge.neueGruppe}</Label>
            <Input
              id="neue-gruppe"
              value={neueGruppe}
              onChange={(e) => setNeueGruppe(e.target.value)}
              placeholder={worte.zugaenge.gruppeBeispiel}
              onKeyDown={(e) => {
                if (e.key === "Enter" && neueGruppe.trim()) anlegen.mutate();
              }}
            />
          </div>
          <Button disabled={!neueGruppe.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
            {worte.zugaenge.anlegen}
          </Button>
        </Card>

        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="neue-person">{worte.zugaenge.neuePerson}</Label>
            <Input
              id="neue-person"
              type="email"
              value={neueEmail}
              onChange={(e) => setNeueEmail(e.target.value)}
              placeholder={worte.zugaenge.personBeispiel}
              onKeyDown={(e) => {
                if (e.key === "Enter" && neueEmail.trim()) nutzerAnlegen.mutate();
              }}
            />
          </div>
          <Button
            disabled={!neueEmail.trim() || nutzerAnlegen.isPending}
            onClick={() => nutzerAnlegen.mutate()}
          >
            {worte.zugaenge.anlegen}
          </Button>
        </Card>
      </div>

      {laedt ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : gruppenListe.length === 0 ? (
        <EmptyState
          title={worte.zugaenge.keineGruppe}
          body={worte.zugaenge.keineGruppeText}
        />
      ) : (
        <div className="grid gap-4">
          {gruppenListe.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  {g.source === "ad" && (
                    <Badge variant="secondary" title={worte.zugaenge.ausVerzeichnis}>
                      {worte.zugaenge.verzeichnis}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setMitglieder(g)}>
                    <UserPlus className="h-3.5 w-3.5" />
                    {(mitgliederVon.get(g.id) ?? []).length} Mitglieder
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setUmbenennen({ gruppe: g, name: g.name })}
                    aria-label={`${g.name} umbenennen`}
                    title={worte.zugaenge.umbenennen}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <ConfirmDeleteButton
                    itemLabel={g.name}
                    onConfirm={async () => {
                      await loeschen.mutateAsync(g.id);
                    }}
                  />
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {appListe.map((a) => {
                  const feldId = `${g.id}-${a.id}`;
                  const aktuell = rechtVon.get(`${g.id}|${a.id}`) ?? "";
                  return (
                    <div key={a.id} className="flex flex-col gap-1">
                      <Label htmlFor={feldId}>{a.name}</Label>
                      <Select
                        id={feldId}
                        value={aktuell}
                        onChange={(e) =>
                          rechtSetzen.mutate({
                            group_id: g.id,
                            app_id: a.id,
                            level: (e.target.value || null) as Level | null,
                          })
                        }
                        className="h-8 text-xs"
                      >
                        <option value="">{worte.zugaenge.keinZugriff}</option>
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {LEVEL_LABEL[l]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--fg-muted)]">
        {worte.einstellungenText.verwaltenSchliesstEin}
      </p>

      <Dialog
        open={zugang !== null}
        onOpenChange={(o) => !o && setZugang(null)}
        title={zugang?.titel ?? ""}
        description={worte.zugaenge.passwortNurJetzt}
        footer={
          <Button onClick={() => setZugang(null)}>{worte.zugaenge.fertig}</Button>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <Label>{worte.zugaenge.anmeldung}</Label>
            <code className="rounded-md border border-[var(--border)] px-3 py-2">
              {zugang?.email}
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{worte.zugaenge.passwort}</Label>
            <code className="rounded-md border border-[var(--border)] px-3 py-2 tracking-wider">
              {zugang?.passwort}
            </code>
          </div>
          <p className="text-[var(--fg-muted)]">
            {worte.zugaenge.rechteAnGruppe}
          </p>
        </div>
      </Dialog>

      <Dialog
        open={umbenennen !== null}
        onOpenChange={(o) => !o && setUmbenennen(null)}
        title={worte.zugaenge.gruppeUmbenennen}
        footer={
          <>
            <Button variant="outline" onClick={() => setUmbenennen(null)}>
              {worte.zugaenge.abbrechen}
            </Button>
            <Button
              disabled={!umbenennen?.name.trim() || umbenennenMutation.isPending}
              onClick={() =>
                umbenennen &&
                umbenennenMutation.mutate({ id: umbenennen.gruppe.id, name: umbenennen.name.trim() })
              }
            >
              {worte.zugaenge.speichern}
            </Button>
          </>
        }
      >
        <Input
          value={umbenennen?.name ?? ""}
          aria-label={worte.zugaenge.gruppenname}
          onChange={(e) => setUmbenennen((v) => (v ? { ...v, name: e.target.value } : v))}
          autoFocus
        />
      </Dialog>

      <Dialog
        open={mitglieder !== null}
        onOpenChange={(o) => {
          if (!o) {
            setMitglieder(null);
            setNeuesMitglied("");
          }
        }}
        title={worte.zugaenge.mitgliederVon(mitglieder?.name ?? "")}
        description={worte.zugaenge.wirktNachAnmeldung}
        className="w-[min(36rem,calc(100vw-2rem))]"
        footer={
          <Button variant="outline" onClick={() => setMitglieder(null)}>
            {worte.zugaenge.schliessen}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="mitglied-waehlen">{worte.zugaenge.personHinzufuegen}</Label>
              <Select
                id="mitglied-waehlen"
                value={neuesMitglied}
                onChange={(e) => setNeuesMitglied(e.target.value)}
              >
                <option value="">{worte.zugaenge.auswaehlen}</option>
                {nochNichtMitglied.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.email ?? n.id}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              disabled={!neuesMitglied || mitgliedHinzu.isPending}
              onClick={() =>
                mitglieder &&
                mitgliedHinzu.mutate({ group_id: mitglieder.id, user_id: neuesMitglied })
              }
            >
              <Check className="h-4 w-4" /> {worte.zugaenge.hinzufuegen}
            </Button>
          </div>

          {mitgliederDerGruppe.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">{worte.zugaenge.keineMitglieder}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {mitgliederDerGruppe.map((id) => (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                >
                  <span>
                    {nutzerNach.get(id)?.email ?? id}
                    {id === eigeneId && (
                      <span className="ml-2 text-xs text-[var(--fg-muted)]">(du)</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={worte.zugaenge.passwortZuruecksetzen}
                      title={worte.zugaenge.passwortZuruecksetzen}
                      disabled={passwortNeu.isPending}
                      onClick={() => passwortNeu.mutate(id)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={worte.zugaenge.mitgliedEntfernen}
                      title={worte.zugaenge.entfernen}
                      disabled={mitgliedWeg.isPending}
                      onClick={() =>
                        mitglieder && mitgliedWeg.mutate({ group_id: mitglieder.id, user_id: id })
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </div>
  );
}
