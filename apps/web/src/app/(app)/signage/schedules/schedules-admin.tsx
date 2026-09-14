"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

import { signageApi, signageKeys } from "@/lib/signage/api";
import type { SignageSchedule } from "@/lib/signage/types";
import {
  hhmmFromString,
  hhmmToString,
  weekdayMaskFromArray,
  weekdayMaskToArray,
  weekdaysLabel,
} from "@/lib/signage/schedule";
import {
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  Switch,
  TableWrap,
} from "@/components/ui/primitives";
import { Datentabelle } from "@/components/ui/datentabelle";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge } from "@/components/sidebar/werkzeugplatz";

interface DraftState {
  playlist_id: string;
  days: boolean[];
  start: string;
  end: string;
  priority: number;
  enabled: boolean;
}

const EMPTY_DRAFT: DraftState = {
  playlist_id: "",
  days: [true, true, true, true, true, false, false],
  start: "08:00",
  end: "17:00",
  priority: 0,
  enabled: true,
};

export function SchedulesAdmin() {
  const worte = useTexte();
  const weekdaysLabel2 = (mask: number) =>
    weekdaysLabel(mask, worte.signage.wochentagKuerzel, worte.signage.taeglich);
  const queryClient = useQueryClient();
  // undefined = Dialog zu, null = neu, Objekt = bearbeiten
  const [editing, setEditing] = useState<SignageSchedule | null | undefined>(undefined);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const { data: schedules = [], isLoading, isError } = useQuery({
    queryKey: signageKeys.schedules(),
    queryFn: signageApi.listSchedules,
  });
  const { data: playlists = [] } = useQuery({
    queryKey: signageKeys.playlists(),
    queryFn: signageApi.listPlaylists,
  });
  const playlistName = useMemo(() => new Map(playlists.map((p) => [p.id, p.name])), [playlists]);

  /** Dialog öffnen und den Entwurf im selben Schritt füllen — kein Effekt,
   *  der auf eine Zustandsänderung reagiert. */
  function openDialog(schedule: SignageSchedule | null) {
    setError(null);
    setDraft(
      schedule === null
        ? { ...EMPTY_DRAFT, playlist_id: playlists[0]?.id ?? "" }
        : {
            playlist_id: schedule.playlist_id,
            days: weekdayMaskToArray(schedule.weekday_mask),
            start: hhmmToString(schedule.start_hhmm),
            end: hhmmToString(schedule.end_hhmm),
            priority: schedule.priority,
            enabled: schedule.enabled,
          },
    );
    setEditing(schedule);
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: signageKeys.schedules() });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const start = hhmmFromString(draft.start);
      const end = hhmmFromString(draft.end);
      if (start === null || end === null) throw new Error("Zeit im Format HH:MM angeben.");
      if (start >= end) throw new Error(worte.signage.endeNachStart);
      if (!draft.playlist_id) throw new Error(worte.signage.playlistWaehlen);
      const mask = weekdayMaskFromArray(draft.days);
      if (mask === 0) throw new Error(worte.signage.mindestensEinTag);
      const body = {
        playlist_id: draft.playlist_id,
        weekday_mask: mask,
        start_hhmm: start,
        end_hhmm: end,
        priority: draft.priority,
        enabled: draft.enabled,
      };
      return editing
        ? signageApi.updateSchedule(editing.id, body)
        : signageApi.createSchedule(body);
    },
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      toast.success("Zeitplan gespeichert.");
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      signageApi.updateSchedule(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      // Optimistisch umschalten und bei Fehler zurückrollen.
      const key = signageKeys.schedules();
      const previous = queryClient.getQueryData<SignageSchedule[]>(key);
      queryClient.setQueryData<SignageSchedule[]>(key, (list) =>
        (list ?? []).map((s) => (s.id === id ? { ...s, enabled } : s)),
      );
      return { previous };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(signageKeys.schedules(), context.previous);
      toast.error(`Umschalten fehlgeschlagen: ${err.message}`);
    },
    onSettled: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => signageApi.deleteSchedule(id),
    onSuccess: () => {
      invalidate();
      toast.success("Zeitplan gelöscht.");
    },
    onError: (err: Error) => toast.error(`Löschen fehlgeschlagen: ${err.message}`),
  });

  const sorted = useMemo(
    () =>
      [...schedules].sort(
        (a, b) => b.priority - a.priority || b.updated_at.localeCompare(a.updated_at),
      ),
    [schedules],
  );

  const dialog = (
    <Dialog
      open={editing !== undefined}
      onOpenChange={(o) => !o && setEditing(undefined)}
      title={editing ? "Zeitplan bearbeiten" : "Neuer Zeitplan"}
      description={worte.signage.zeitplanHinweis}
      footer={
        <>
          <Button variant="outline" onClick={() => setEditing(undefined)}>
            {worte.signage.abbrechen}
          </Button>
          <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {worte.signage.speichern}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="sched-playlist">{worte.signage.playlist}</Label>
          <Select
            id="sched-playlist"
            value={draft.playlist_id}
            onChange={(e) => setDraft({ ...draft, playlist_id: e.target.value })}
          >
            <option value="">— auswählen —</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{worte.signage.wochentage}</legend>
          <div className="flex gap-1">
            {worte.signage.wochentagKuerzel.map((label, index) => (
              <label
                key={label}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={draft.days[index]}
                  aria-label={label}
                  onChange={(e) => {
                    const days = [...draft.days];
                    days[index] = e.target.checked;
                    setDraft({ ...draft, days });
                  }}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="sched-start">{worte.signage.von}</Label>
            <Input
              id="sched-start"
              type="time"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="sched-end">{worte.signage.bis}</Label>
            <Input
              id="sched-end"
              type="time"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="sched-priority">{worte.signage.prioritaet}</Label>
            <Input
              id="sched-priority"
              type="number"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={draft.enabled}
            label={worte.signage.zeitplanAktiv}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
          <span className="text-sm">aktiv</span>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );

  if (isLoading) {
    return <TableWrap className="p-5 text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</TableWrap>;
  }
  if (isError) {
    return (
      <TableWrap className="p-5 text-sm text-[var(--danger)]">
        {worte.signage.zeitplaeneFehler}
      </TableWrap>
    );
  }
  if (sorted.length === 0) {
    return (
      <>
        <EmptyState
          title={worte.signage.keineZeitplaene}
          body={worte.signage.keineZeitplaeneText}
          action={
            <Button onClick={() => openDialog(null)} disabled={playlists.length === 0}>
              {playlists.length === 0 ? "Zuerst Playlist anlegen" : "Zeitplan anlegen"}
            </Button>
          }
        />
        {dialog}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* Vorsortiert nach Priorität und letzter Änderung; die Tabelle sortiert
          stabil, ohne gewählte Spalte bleibt diese Reihenfolge. */}
      <Datentabelle
        zeilen={sorted}
        zeilenSchluessel={(s) => s.id}
        beschriftung={worte.signage.zeitplaene}
        spalten={[
          {
            schluessel: "playlist",
            titel: worte.signage.playlist,
            typ: "text",
            wert: (s) => playlistName.get(s.playlist_id) ?? `${s.playlist_id.slice(0, 8)}…`,
            className: "font-medium",
          },
          {
            schluessel: "tage",
            titel: worte.signage.tage,
            typ: "text",
            wert: (s) => weekdaysLabel2(s.weekday_mask),
          },
          {
            schluessel: "zeitfenster",
            titel: worte.signage.zeitfenster,
            typ: "zahl",
            wert: (s) => s.start_hhmm,
            zelle: (s) => `${hhmmToString(s.start_hhmm)} – ${hhmmToString(s.end_hhmm)}`,
            suchtext: (s) => `${hhmmToString(s.start_hhmm)} – ${hhmmToString(s.end_hhmm)}`,
            className: "font-mono tabular-nums",
          },
          {
            schluessel: "prioritaet",
            titel: worte.signage.prioritaet,
            typ: "zahl",
            wert: (s) => s.priority,
            ausrichtung: "end",
            className: "font-mono",
          },
          {
            schluessel: "aktiv",
            titel: worte.signage.aktiv,
            typ: "zahl",
            wert: (s) => (s.enabled ? 1 : 0),
            suchtext: false,
            zelle: (s) => (
              <Switch
                checked={s.enabled}
                label={worte.signage.zeitplanAktiv}
                onCheckedChange={(enabled) => toggleMutation.mutate({ id: s.id, enabled })}
              />
            ),
          },
          {
            schluessel: "aktionen",
            titel: worte.signage.aktionen,
            typ: "text",
            wert: () => null,
            sortierbar: false,
            suchtext: false,
            ausrichtung: "end",
            zelle: (s) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openDialog(s)}
                  aria-label={worte.signage.zeitplanBearbeiten}
                  title={worte.signage.bearbeiten}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <ConfirmDeleteButton
                  itemLabel={`Zeitplan ${hhmmToString(s.start_hhmm)}–${hhmmToString(s.end_hhmm)}`}
                  onConfirm={async () => {
                    await deleteMutation.mutateAsync(s.id);
                  }}
                />
              </div>
            ),
          },
        ]}
      />
      <Seitenwerkzeuge kategorie="aktionen">
        <div className="flex flex-col items-stretch gap-2">
          <Button onClick={() => openDialog(null)}>{worte.signage.neuerZeitplan}</Button>
        </div>
      </Seitenwerkzeuge>
      {dialog}
    </div>
  );
}
