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

/**
 * Gruppen, Mitglieder und App-Rechte pflegen.
 *
 * Das Modell trägt bereits die spätere Verzeichnis-Anbindung: Gruppen mit
 * Quelle „ad“ werden hier nicht bearbeitet, ihre Mitglieder kommen dann aus
 * dem Verzeichnis. Die App-Rechte bleiben in jedem Fall hier.
 */
export function Verwaltung({ eigeneId }: { eigeneId: string }) {
  const queryClient = useQueryClient();
  const [neueGruppe, setNeueGruppe] = useState("");
  const [umbenennen, setUmbenennen] = useState<{ gruppe: Gruppe; name: string } | null>(null);
  const [mitglieder, setMitglieder] = useState<Gruppe | null>(null);
  const [neuesMitglied, setNeuesMitglied] = useState("");
  const [neueEmail, setNeueEmail] = useState("");
  const [zugang, setZugang] = useState<{ titel: string; email: string; passwort: string } | null>(
    null,
  );

  // Nur die Zahl der noch nicht angesehenen Meldungen — die Liste selbst
  // holt die eigene Seite.
  const meldungen = useQuery({ queryKey: feedbackKeys.liste(), queryFn: feedbackApi.liste });
  const ungesehene = (meldungen.data ?? []).filter((m) => m.gesehen_am === null).length;

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
      toast.success("Gruppe angelegt.");
    },
    onError: (err: Error) =>
      toast.error(
        /duplicate|unique/i.test(err.message)
          ? "Diesen Gruppennamen gibt es schon."
          : `Anlegen fehlgeschlagen: ${err.message}`,
      ),
  });

  const nutzerAnlegen = useMutation({
    mutationFn: () => verwaltungApi.nutzerAnlegen(neueEmail.trim()),
    onSuccess: (nutzer) => {
      setNeueEmail("");
      setZugang({ titel: "Person angelegt", email: nutzer.email, passwort: nutzer.passwort });
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
      toast.success("Gruppe umbenannt.");
    },
    onError: (err: Error) => toast.error(`Umbenennen fehlgeschlagen: ${err.message}`),
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => verwaltungApi.gruppeLoeschen(id),
    onSuccess: () => {
      neuLaden(verwaltungKeys.gruppen(), verwaltungKeys.rechte(), verwaltungKeys.mitgliedschaften());
      toast.success("Gruppe gelöscht.");
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
      toast.success("Mitglied hinzugefügt. Es wirkt nach der nächsten Anmeldung.");
    },
    onError: (err: Error) =>
      toast.error(
        /duplicate|unique/i.test(err.message)
          ? "Diese Person ist schon in der Gruppe."
          : `Hinzufügen fehlgeschlagen: ${err.message}`,
      ),
  });

  const passwortNeu = useMutation({
    mutationFn: (user_id: string) => verwaltungApi.passwortZuruecksetzen(user_id),
    onSuccess: (antwort, user_id) =>
      setZugang({
        titel: "Neues Passwort",
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
      toast.success("Mitglied entfernt. Es wirkt nach der nächsten Anmeldung.");
    },
    onError: (err: Error) => toast.error(`Entfernen fehlgeschlagen: ${err.message}`),
  });

  const laedt = apps.isLoading || gruppen.isLoading;
  const fehler = apps.error ?? gruppen.error ?? rechte.error ?? nutzer.error;

  const mitgliederDerGruppe = mitglieder ? (mitgliederVon.get(mitglieder.id) ?? []) : [];
  const nochNichtMitglied = nutzerListe.filter((n) => !mitgliederDerGruppe.includes(n.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Verwaltung</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Gruppen bündeln Personen, App-Rechte hängen an der Gruppe. Änderungen wirken, sobald
            sich die betroffene Person das nächste Mal anmeldet — die Rechte stehen in ihrem Token.
          </p>
        </div>
        <Link
          href="/platform/feedback"
          className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline"
        >
          Meldungen
          {ungesehene > 0 && <Badge>{ungesehene}</Badge>}
        </Link>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Verwaltungsdaten konnten nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="neue-gruppe">Neue Gruppe</Label>
            <Input
              id="neue-gruppe"
              value={neueGruppe}
              onChange={(e) => setNeueGruppe(e.target.value)}
              placeholder="z. B. Vertrieb Innendienst"
              onKeyDown={(e) => {
                if (e.key === "Enter" && neueGruppe.trim()) anlegen.mutate();
              }}
            />
          </div>
          <Button disabled={!neueGruppe.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
            Anlegen
          </Button>
        </Card>

        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="neue-person">Neue Person</Label>
            <Input
              id="neue-person"
              type="email"
              value={neueEmail}
              onChange={(e) => setNeueEmail(e.target.value)}
              placeholder="vorname.nachname@acm.local"
              onKeyDown={(e) => {
                if (e.key === "Enter" && neueEmail.trim()) nutzerAnlegen.mutate();
              }}
            />
          </div>
          <Button
            disabled={!neueEmail.trim() || nutzerAnlegen.isPending}
            onClick={() => nutzerAnlegen.mutate()}
          >
            Anlegen
          </Button>
        </Card>
      </div>

      {laedt ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : gruppenListe.length === 0 ? (
        <EmptyState
          title="Noch keine Gruppe"
          body="Lege eine Gruppe an, weise ihr App-Rechte zu und nimm Personen auf."
        />
      ) : (
        <div className="grid gap-4">
          {gruppenListe.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  {g.source === "ad" && (
                    <Badge variant="secondary" title="Kommt aus dem Verzeichnis">
                      Verzeichnis
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
                    title="Umbenennen"
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
                        <option value="">kein Zugriff</option>
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
        „Verwalten“ auf der Plattform-Kachel schließt jedes andere Recht ein.
      </p>

      <Dialog
        open={zugang !== null}
        onOpenChange={(o) => !o && setZugang(null)}
        title={zugang?.titel ?? ""}
        description="Das Passwort steht nur jetzt hier. Danach lässt es sich nur zurücksetzen, nicht anzeigen."
        footer={
          <Button onClick={() => setZugang(null)}>Fertig</Button>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <Label>Anmeldung</Label>
            <code className="rounded-md border border-[var(--border)] px-3 py-2">
              {zugang?.email}
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Passwort</Label>
            <code className="rounded-md border border-[var(--border)] px-3 py-2 tracking-wider">
              {zugang?.passwort}
            </code>
          </div>
          <p className="text-[var(--fg-muted)]">
            Rechte hängen an der Gruppe, nicht an der Person.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={umbenennen !== null}
        onOpenChange={(o) => !o && setUmbenennen(null)}
        title="Gruppe umbenennen"
        footer={
          <>
            <Button variant="outline" onClick={() => setUmbenennen(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={!umbenennen?.name.trim() || umbenennenMutation.isPending}
              onClick={() =>
                umbenennen &&
                umbenennenMutation.mutate({ id: umbenennen.gruppe.id, name: umbenennen.name.trim() })
              }
            >
              Speichern
            </Button>
          </>
        }
      >
        <Input
          value={umbenennen?.name ?? ""}
          aria-label="Gruppenname"
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
        title={`Mitglieder von „${mitglieder?.name ?? ""}“`}
        description="Änderungen wirken, sobald sich die Person das nächste Mal anmeldet."
        className="w-[min(36rem,calc(100vw-2rem))]"
        footer={
          <Button variant="outline" onClick={() => setMitglieder(null)}>
            Schließen
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="mitglied-waehlen">Person hinzufügen</Label>
              <Select
                id="mitglied-waehlen"
                value={neuesMitglied}
                onChange={(e) => setNeuesMitglied(e.target.value)}
              >
                <option value="">— auswählen —</option>
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
              <Check className="h-4 w-4" /> Hinzufügen
            </Button>
          </div>

          {mitgliederDerGruppe.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">Diese Gruppe hat noch keine Mitglieder.</p>
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
                      aria-label="Passwort zurücksetzen"
                      title="Passwort zurücksetzen"
                      disabled={passwortNeu.isPending}
                      onClick={() => passwortNeu.mutate(id)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Mitglied entfernen"
                      title="Entfernen"
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
