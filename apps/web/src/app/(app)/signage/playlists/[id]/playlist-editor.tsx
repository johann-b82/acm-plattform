"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, GripVertical, Loader2, Plus, X } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { mediaFileUrl, signageApi, signageKeys } from "@/lib/signage/api";
import type { SignageMedia, SignagePlaylist, SignagePlaylistItem, SignageTag } from "@/lib/signage/types";
import { Button, ButtonLink, Card, Input, Label, Select } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { TagPicker } from "@/components/signage/tag-picker";
import { uuid } from "@/lib/uuid";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge } from "@/components/sidebar/werkzeugplatz";

type Transition = "fade" | "cut";

interface ItemDraft {
  /** Stabiler Schlüssel für die Sortierung (nicht die Server-ID). */
  key: string;
  media_id: string;
  duration_s: number;
  transition: Transition;
}

interface EditorData {
  playlist: SignagePlaylist;
  playlistItems: SignagePlaylistItem[];
  media: SignageMedia[];
  allTags: SignageTag[];
}

function Thumb({ media }: { media: SignageMedia | undefined }) {
  const url = media && media.kind === "image" ? mediaFileUrl(media) : null;
  const slide =
    media?.kind === "pptx" && media.slide_paths?.length
      ? `/api/signage/media/${media.id}/slide/1`
      : null;
  const src = url ?? slide;
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--muted)]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Datei kommt über den Proxy
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-[10px] text-[var(--fg-muted)]">{media?.kind ?? "?"}</span>
      )}
    </div>
  );
}

function SortableRow({
  item,
  media,
  onChange,
  onRemove,
}: {
  item: ItemDraft;
  media: SignageMedia | undefined;
  onChange: (next: ItemDraft) => void;
  onRemove: () => void;
}) {
  const worte = useTexte();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  });
  const title = media?.title ?? worte.signage.unbekanntesMedium;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`${title} verschieben`}
        aria-roledescription={worte.signage.ziehpunkt}
        className="cursor-grab touch-none rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--muted)]"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Thumb media={media} />
      <span className="min-w-0 flex-1 truncate text-sm" title={title}>
        {title}
      </span>
      <label className="flex items-center gap-1 text-xs text-[var(--fg-muted)]">
        <Input
          type="number"
          min={1}
          max={3600}
          value={item.duration_s}
          onChange={(e) => onChange({ ...item, duration_s: Math.max(1, Number(e.target.value) || 1) })}
          aria-label={`Dauer für ${title} in Sekunden`}
          className="w-20"
        />
        s
      </label>
      <Select
        value={item.transition}
        onChange={(e) => onChange({ ...item, transition: e.target.value as Transition })}
        aria-label={`Übergang für ${title}`}
        className="w-32"
      >
        <option value="fade">{worte.signage.ueberblenden}</option>
        <option value="cut">{worte.signage.harterSchnitt}</option>
      </Select>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`${title} entfernen`}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Lädt die Daten und montiert das Formular erst, wenn sie da sind. So kann
 *  der Formularzustand aus den Props initialisiert werden, statt ihn in einem
 *  Effekt nachzuziehen. */
export function PlaylistEditor({ playlistId }: { playlistId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: signageKeys.playlistEditor(playlistId),
    queryFn: async (): Promise<EditorData> => {
      const [playlist, playlistItems, media, allTags] = await Promise.all([
        signageApi.getPlaylist(playlistId),
        signageApi.listPlaylistItems(playlistId),
        signageApi.listMedia(),
        signageApi.listTags(),
      ]);
      return { playlist, playlistItems, media, allTags };
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--fg-muted)]" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card className="p-5 text-sm text-[var(--danger)]">Playlist konnte nicht geladen werden.</Card>
    );
  }
  // `key` erzwingt einen frischen Formularzustand, wenn eine andere Playlist
  // geöffnet wird.
  return <EditorForm key={data.playlist.id} data={data} />;
}

function EditorForm({ data }: { data: EditorData }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const playlistId = data.playlist.id;
  const tagById = useMemo(
    () => new Map(data.allTags.map((t) => [t.id, t.name])),
    [data.allTags],
  );

  const [name, setName] = useState(data.playlist.name);
  const [tags, setTags] = useState<string[]>(() =>
    (data.playlist.tag_ids ?? []).flatMap((id) => {
      const n = tagById.get(id);
      return n ? [n] : [];
    }),
  );
  const [items, setItems] = useState<ItemDraft[]>(() =>
    data.playlistItems.map((it) => ({
      key: uuid(),
      media_id: it.media_id,
      duration_s: it.duration_s,
      transition: it.transition === "cut" ? "cut" : "fade",
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const mediaById = useMemo(() => {
    const map = new Map<string, SignageMedia>();
    for (const m of data.media) map.set(m.id, m);
    return map;
  }, [data.media]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const tagIds = await signageApi.resolveTagIds(tags);
      await signageApi.updatePlaylist(playlistId, { name: name.trim(), tag_ids: tagIds });
      await signageApi.replacePlaylistItems(
        playlistId,
        items.map((it, index) => ({
          media_id: it.media_id,
          position: index,
          duration_s: it.duration_s,
          transition: it.transition,
        })),
      );
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: signageKeys.playlistEditor(playlistId) });
      queryClient.invalidateQueries({ queryKey: signageKeys.playlists() });
      queryClient.invalidateQueries({ queryKey: signageKeys.tags() });
      queryClient.invalidateQueries({ queryKey: signageKeys.devices() });
      toast.success(worte.signage.playlistGespeichert);
    },
    onError: (err: Error) => toast.error(`Speichern fehlgeschlagen: ${err.message}`),
  });

  // Warnung beim Verlassen mit ungespeicherten Änderungen.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function update(next: ItemDraft[]) {
    setItems(next);
    setDirty(true);
  }

  function reset() {
    setName(data.playlist.name);
    setTags(
      (data.playlist.tag_ids ?? []).flatMap((id) => {
        const n = tagById.get(id);
        return n ? [n] : [];
      }),
    );
    setItems(
      data.playlistItems.map((it) => ({
        key: uuid(),
        media_id: it.media_id,
        duration_s: it.duration_s,
        transition: it.transition === "cut" ? "cut" : "fade",
      })),
    );
    setDirty(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.key === active.id);
    const to = items.findIndex((i) => i.key === over.id);
    if (from === -1 || to === -1) return;
    update(arrayMove(items, from, to));
  }

  const totalSeconds = items.reduce((sum, it) => sum + it.duration_s, 0);

  return (
    <div className="space-y-5">
      {/* Zurück, Verwerfen und Speichern gelten für die ganze Playlist — Name,
          Tags und Einträge. In der Schale stehen sie in der rechten Leiste:
          Zurück unter Navigation, Verwerfen und Speichern unter Aktionen. */}
      <Seitenwerkzeuge kategorie="navigation">
        <ButtonLink href="/signage/playlists" variant="outline">
          <ArrowLeft className="me-2 h-4 w-4 rtl:rotate-180" aria-hidden />
          Alle Playlists
        </ButtonLink>
      </Seitenwerkzeuge>
      <Seitenwerkzeuge kategorie="aktionen">
        <div className="flex flex-col items-stretch gap-2">
          <Button variant="outline" disabled={!dirty || saveMutation.isPending} onClick={reset}>
            {worte.signage.verwerfen}
          </Button>
          <Button
            disabled={!dirty || !name.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {worte.signage.speichern}
          </Button>
        </div>
      </Seitenwerkzeuge>

      <Card className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="editor-name">{worte.signage.name}</Label>
          <Input
            id="editor-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            maxLength={128}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label>{worte.signage.zielTags}</Label>
          <TagPicker
            value={tags}
            onChange={(next) => {
              setTags(next);
              setDirty(true);
            }}
          />
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Einträge</h2>
          <p className="text-xs text-[var(--fg-muted)]">
            {items.length} Einträge, Durchlauf {Math.floor(totalSeconds / 60)}:
            {String(totalSeconds % 60).padStart(2, "0")} min
          </p>
        </div>

        {items.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm font-medium">Noch keine Einträge</p>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              {worte.signage.medienHinzufuegen}
            </p>
          </Card>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <SortableRow
                    key={item.key}
                    item={item}
                    media={mediaById.get(item.media_id)}
                    onChange={(next) => update(items.map((i) => (i.key === next.key ? next : i)))}
                    onRemove={() => update(items.filter((i) => i.key !== item.key))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <Button variant="outline" className="w-full" onClick={() => setPickerOpen(true)}>
          <Plus className="h-4 w-4" /> {worte.signage.mediumHinzufuegen}
        </Button>
      </section>

      <Dialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={worte.signage.mediumWaehlen}
        description={worte.signage.mediumWaehlenText}
        className="w-[min(40rem,calc(100vw-2rem))]"
        footer={
          <Button variant="outline" onClick={() => setPickerOpen(false)}>
            {worte.signage.schliessen}
          </Button>
        }
      >
        <div className="max-h-80 overflow-y-auto">
          {data.media.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">
              {worte.signage.keineMedienAnlegen}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.media.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      update([
                        ...items,
                        { key: uuid(), media_id: m.id, duration_s: 10, transition: "fade" },
                      ]);
                      setPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-md p-2 text-start hover:bg-[var(--muted)]"
                  >
                    <Thumb media={m} />
                    <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
                    <span className="text-xs text-[var(--fg-muted)]">{m.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </div>
  );
}
