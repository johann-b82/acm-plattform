"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Pencil, UserPlus, X } from "lucide-react";

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verwaltung</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Gruppen bündeln Personen, App-Rechte hängen an der Gruppe. Änderungen wirken, sobald sich
          die betroffene Person das nächste Mal anmeldet — die Rechte stehen in ihrem Token.
        </p>
      </div>

      {fehler && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Verwaltungsdaten konnten nicht geladen werden: {(fehler as Error).message}
        </Card>
      )}

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
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </div>
  );
}
