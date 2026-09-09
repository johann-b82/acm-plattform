"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Pencil } from "lucide-react";

import { ApiError, signageApi, signageKeys } from "@/lib/signage/api";
import type { SignagePlaylist } from "@/lib/signage/types";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  Switch,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { TagPicker } from "@/components/signage/tag-picker";

export function PlaylistsAdmin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const { data: playlists = [], isLoading, isError } = useQuery({
    queryKey: signageKeys.playlists(),
    queryFn: signageApi.listPlaylists,
  });
  const { data: allTags = [] } = useQuery({
    queryKey: signageKeys.tags(),
    queryFn: signageApi.listTags,
    staleTime: 60_000,
  });
  const tagName = new Map(allTags.map((t) => [t.id, t.name]));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: signageKeys.playlists() });

  const createMutation = useMutation({
    mutationFn: async () => {
      const tagIds = await signageApi.resolveTagIds(tags);
      return signageApi.createPlaylist({ name: name.trim(), tag_ids: tagIds });
    },
    onSuccess: (playlist) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: signageKeys.tags() });
      setNewOpen(false);
      setName("");
      setTags([]);
      router.push(`/signage/playlists/${playlist.id}`);
    },
    onError: (err: Error) => toast.error(`Anlegen fehlgeschlagen: ${err.message}`),
  });

  const duplicateMutation = useMutation({
    mutationFn: (source: SignagePlaylist) =>
      signageApi.createPlaylist({
        name: `${source.name} (Kopie)`,
        description: source.description,
        priority: source.priority,
        enabled: source.enabled,
        tag_ids: source.tag_ids ?? [],
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Playlist kopiert. Die Einträge werden nicht mitkopiert.");
    },
    onError: (err: Error) => toast.error(`Kopieren fehlgeschlagen: ${err.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      signageApi.updatePlaylist(id, { enabled }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => {
      invalidate();
      toast.error(`Umschalten fehlgeschlagen: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => signageApi.deletePlaylist(id),
    onSuccess: () => {
      invalidate();
      toast.success("Playlist gelöscht.");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { schedule_ids?: string[] } | null;
        const count = body?.schedule_ids?.length ?? 0;
        toast.error("Playlist hat aktive Zeitpläne", {
          description: `${count} Zeitplan/Zeitpläne verweisen darauf. Lösche sie zuerst.`,
          action: { label: "Zu den Zeitplänen", onClick: () => router.push("/signage/schedules") },
        });
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      toast.error(`Löschen fehlgeschlagen: ${detail}`);
    },
  });

  const dateFmt = new Intl.DateTimeFormat("de", { dateStyle: "medium" });

  const newDialog = (
    <Dialog
      open={newOpen}
      onOpenChange={(o) => {
        setNewOpen(o);
        if (!o) {
          setName("");
          setTags([]);
        }
      }}
      title="Neue Playlist"
      description="Name und Ziel-Tags festlegen. Die Einträge kommen im nächsten Schritt."
      footer={
        <>
          <Button variant="outline" onClick={() => setNewOpen(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Anlegen und bearbeiten
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pl-name">Name</Label>
          <Input
            id="pl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Empfang"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Tags</Label>
          <TagPicker value={tags} onChange={setTags} />
          <p className="text-xs text-[var(--fg-muted)]">
            Ein Gerät zeigt die Playlist, wenn sich mindestens ein Tag überschneidet.
          </p>
        </div>
      </div>
    </Dialog>
  );

  if (isLoading) {
    return <TableWrap className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</TableWrap>;
  }
  if (isError) {
    return (
      <TableWrap className="p-5 text-sm text-[var(--danger)]">
        Playlists konnten nicht geladen werden.
      </TableWrap>
    );
  }
  if (playlists.length === 0) {
    return (
      <>
        <EmptyState
          title="Noch keine Playlist"
          body="Eine Playlist bündelt Medien in einer Reihenfolge und wird über Tags an Geräte verteilt."
          action={<Button onClick={() => setNewOpen(true)}>Playlist anlegen</Button>}
        />
        {newDialog}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Tags</Th>
              <Th className="text-right">Priorität</Th>
              <Th>Aktiv</Th>
              <Th>Erstellt</Th>
              <Th className="text-right">Aktionen</Th>
            </tr>
          </thead>
          <tbody>
            {playlists.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">
                  <Link href={`/signage/playlists/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {(p.tag_ids ?? []).map((id) => (
                      <Badge key={id} variant="secondary">
                        {tagName.get(id) ?? id}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td className="text-right font-mono tabular-nums">{p.priority}</Td>
                <Td>
                  <Switch
                    checked={p.enabled}
                    label={`${p.name} aktiv`}
                    disabled={toggleMutation.isPending}
                    onCheckedChange={(enabled) => toggleMutation.mutate({ id: p.id, enabled })}
                  />
                </Td>
                <Td className="text-[var(--fg-muted)]">{dateFmt.format(new Date(p.created_at))}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => router.push(`/signage/playlists/${p.id}`)}
                      aria-label={`${p.name} bearbeiten`}
                      title="Bearbeiten"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => duplicateMutation.mutate(p)}
                      disabled={duplicateMutation.isPending}
                      aria-label={`${p.name} kopieren`}
                      title="Kopieren"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <ConfirmDeleteButton
                      itemLabel={p.name}
                      onConfirm={async () => {
                        try {
                          await deleteMutation.mutateAsync(p.id);
                        } catch {
                          // onError zeigt den Hinweis mit den Zeitplänen.
                        }
                      }}
                    />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <div className="flex justify-end">
        <Button onClick={() => setNewOpen(true)}>Neue Playlist</Button>
      </div>
      {newDialog}
    </div>
  );
}
