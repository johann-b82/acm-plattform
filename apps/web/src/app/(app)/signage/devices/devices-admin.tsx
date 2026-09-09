"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Power, RefreshCw, ShieldOff } from "lucide-react";

import { signageApi, signageKeys } from "@/lib/signage/api";
import type { SignageDevice, SignageDeviceCommandResult } from "@/lib/signage/types";
import { relativeTime } from "@/lib/signage/schedule";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  Switch,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { DeviceStatusBadge, UptimeBadge } from "@/components/signage/status";
import { TagPicker } from "@/components/signage/tag-picker";

const ROTATIONS = [0, 90, 180, 270] as const;

export function DevicesAdmin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SignageDevice | null>(null);
  const [revoking, setRevoking] = useState<SignageDevice | null>(null);
  const [rebooting, setRebooting] = useState<SignageDevice | null>(null);
  const [form, setForm] = useState({
    name: "",
    tags: [] as string[],
    rotation: 0 as 0 | 90 | 180 | 270,
    audio_enabled: false,
  });

  // 30 s Takt wie im Altprojekt: der Statuschip wechselt innerhalb eines Zyklus.
  const { data: devices = [], isLoading } = useQuery({
    queryKey: signageKeys.devices(),
    queryFn: signageApi.listDevices,
    refetchInterval: 30_000,
  });
  const { data: analytics = [] } = useQuery({
    queryKey: signageKeys.deviceAnalytics(),
    queryFn: signageApi.listDeviceAnalytics,
    refetchInterval: 30_000,
  });
  const { data: tags = [] } = useQuery({
    queryKey: signageKeys.tags(),
    queryFn: signageApi.listTags,
    staleTime: 60_000,
  });

  const analyticsById = useMemo(
    () => new Map(analytics.map((a) => [a.device_id, a])),
    [analytics],
  );
  const tagName = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);

  /** Bearbeiten öffnen und das Formular im selben Schritt füllen. */
  function openEdit(device: SignageDevice) {
    setForm({
      name: device.name,
      tags: (device.tag_ids ?? []).flatMap((id) => {
        const n = tagName.get(id);
        return n ? [n] : [];
      }),
      rotation: device.rotation,
      audio_enabled: device.audio_enabled,
    });
    setEditing(device);
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: signageKeys.devices() });
    queryClient.invalidateQueries({ queryKey: signageKeys.deviceAnalytics() });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("kein Gerät gewählt");
      const tagIds = await signageApi.resolveTagIds(form.tags);
      await signageApi.updateDevice(editing.id, { name: form.name.trim(), tag_ids: tagIds });
      if (form.rotation !== editing.rotation || form.audio_enabled !== editing.audio_enabled) {
        await signageApi.updateCalibration(editing.id, {
          rotation: form.rotation,
          audio_enabled: form.audio_enabled,
        });
      }
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: signageKeys.tags() });
      setEditing(null);
      toast.success("Gerät gespeichert.");
    },
    onError: (err: Error) => toast.error(`Speichern fehlgeschlagen: ${err.message}`),
  });

  const report = (res: SignageDeviceCommandResult, name: string) => {
    if (res.delivered === 0) {
      toast.warning(`„${name}“ ist gerade nicht verbunden. Der Befehl wurde nicht zugestellt.`);
    } else {
      toast.success(res.event === "reload" ? `„${name}“ lädt neu.` : `„${name}“ startet neu.`);
    }
  };
  const commandError = (err: Error) => toast.error(`Befehl fehlgeschlagen: ${err.message}`);

  const reloadMutation = useMutation({
    mutationFn: (d: SignageDevice) => signageApi.reloadDevice(d.id),
    onSuccess: (res, d) => report(res, d.name),
    onError: commandError,
  });
  const rebootMutation = useMutation({
    mutationFn: (d: SignageDevice) => signageApi.rebootDevice(d.id),
    onSuccess: (res, d) => {
      report(res, d.name);
      setRebooting(null);
    },
    onError: commandError,
  });
  const revokeMutation = useMutation({
    mutationFn: (d: SignageDevice) => signageApi.revokeDevice(d.id),
    onSuccess: (_res, d) => {
      invalidate();
      setRevoking(null);
      toast.success(`Zugang von „${d.name}“ entzogen. Das Gerät zeigt wieder den Kopplungscode.`);
    },
    onError: (err: Error) => toast.error(`Entziehen fehlgeschlagen: ${err.message}`),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => signageApi.deleteDevice(id),
    onSuccess: () => {
      invalidate();
      toast.success("Gerät gelöscht.");
    },
    onError: (err: Error) => toast.error(`Löschen fehlgeschlagen: ${err.message}`),
  });

  if (!isLoading && devices.length === 0) {
    return (
      <EmptyState
        title="Noch kein Gerät gekoppelt"
        body="Starte einen Bildschirm mit dem Player. Er zeigt einen sechsstelligen Code, den du hier eingibst."
        action={<Button onClick={() => router.push("/signage/pair")}>Gerät koppeln</Button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Gerät</Th>
              <Th>Status</Th>
              <Th>Verfügbarkeit 24 h</Th>
              <Th>Ausfälle 24 h</Th>
              <Th>Tags</Th>
              <Th>Playlist</Th>
              <Th>Zuletzt gesehen</Th>
              <Th className="text-right">Aktionen</Th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <Td>
                  <div className="flex flex-col">
                    <span className="font-medium">{d.name}</span>
                    {(d.hostname || d.ip_address) && (
                      <span className="font-mono text-xs text-[var(--fg-muted)]">
                        {[d.hostname, d.ip_address].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {d.mac_address && (
                      <span className="font-mono text-[10px] text-[var(--fg-muted)]">
                        {d.mac_address}
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  {d.revoked_at ? (
                    <Badge className="status-bad">entzogen</Badge>
                  ) : (
                    <DeviceStatusBadge lastSeenAt={d.last_seen_at} />
                  )}
                </Td>
                <Td>
                  <UptimeBadge variant="uptime" data={analyticsById.get(d.id)} />
                </Td>
                <Td>
                  <UptimeBadge variant="missed" data={analyticsById.get(d.id)} />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {(d.tag_ids ?? []).map((id) => (
                      <Badge key={id} variant="secondary">
                        {tagName.get(id) ?? id}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td className="text-[var(--fg-muted)]">{d.current_playlist_name ?? "—"}</Td>
                <Td className="text-[var(--fg-muted)]">{relativeTime(d.last_seen_at)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => reloadMutation.mutate(d)}
                      disabled={reloadMutation.isPending}
                      aria-label={`${d.name} neu laden`}
                      title="Seite neu laden"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRebooting(d)}
                      aria-label={`${d.name} neu starten`}
                      title="Gerät neu starten"
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(d)}
                      aria-label={`${d.name} bearbeiten`}
                      title="Bearbeiten"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRevoking(d)}
                      aria-label={`Zugang von ${d.name} entziehen`}
                      title="Zugang entziehen"
                    >
                      <ShieldOff className="h-4 w-4 text-[var(--danger)]" />
                    </Button>
                    <ConfirmDeleteButton
                      itemLabel={d.name}
                      onConfirm={async () => {
                        await deleteMutation.mutateAsync(d.id);
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
        <Button onClick={() => router.push("/signage/pair")}>Gerät koppeln</Button>
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Gerät bearbeiten"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={!form.name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              Speichern
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="dev-name">Name</Label>
            <Input
              id="dev-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={128}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Tags</Label>
            <TagPicker value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
            <p className="text-xs text-[var(--fg-muted)]">
              Bestimmen, welche Playlists und Zeitpläne dieses Gerät bekommt.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="dev-rotation">Bilddrehung</Label>
              <Select
                id="dev-rotation"
                value={String(form.rotation)}
                onChange={(e) =>
                  setForm({ ...form, rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })
                }
              >
                {ROTATIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}°
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Ton</Label>
              <div className="flex h-9 items-center gap-2">
                <Switch
                  checked={form.audio_enabled}
                  label="Ton aktiv"
                  onCheckedChange={(audio_enabled) => setForm({ ...form, audio_enabled })}
                />
                <span className="text-sm">{form.audio_enabled ? "an" : "aus"}</span>
              </div>
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Zugang entziehen"
        description={`„${revoking?.name ?? ""}“ verliert sofort seinen Zugang und zeigt wieder den Kopplungscode.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMutation.isPending}
              onClick={() => revoking && revokeMutation.mutate(revoking)}
            >
              Entziehen
            </Button>
          </>
        }
      />

      <Dialog
        open={rebooting !== null}
        onOpenChange={(o) => !o && setRebooting(null)}
        title="Gerät neu starten"
        description={`„${rebooting?.name ?? ""}“ ist etwa eine Minute lang schwarz.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setRebooting(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={rebootMutation.isPending}
              onClick={() => rebooting && rebootMutation.mutate(rebooting)}
            >
              Neu starten
            </Button>
          </>
        }
      />
    </div>
  );
}
