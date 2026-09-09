import type {
  SignageDevice,
  SignageDeviceAnalytics,
  SignageDeviceCommandResult,
  SignageMedia,
  SignagePlaylist,
  SignagePlaylistItem,
  SignageSchedule,
  SignageTag,
} from "./types";

/**
 * Datenzugriff auf die Signage-API. Alle Aufrufe gehen same-origin an
 * `/api/signage/*`; der Route Handler in `app/api/signage/[...path]` hängt das
 * Access-Token an und reicht an den Signage-Stack weiter.
 *
 * Im Altprojekt war diese Schicht hybrid (Directus-SDK für Lesen, FastAPI für
 * Rechnen). Hier ist alles eine REST-Quelle.
 */

/** Fehler mit Status und JSON-Körper — nötig für die 409-Antworten
 *  `{detail, playlist_ids}` und `{detail, schedule_ids}`. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isFormData = init?.body instanceof FormData;
  if (init?.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api/signage${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, body, detail);
  }
  return body as T;
}

/** URL der Quelldatei für Vorschauen (Admin-authentifiziert über den Proxy). */
export function mediaFileUrl(media: SignageMedia): string | null {
  if (media.kind === "url") return media.uri;
  if (!media.uri || !media.uri.startsWith("files/")) return null;
  return `/api/signage/media/${media.id}/file`;
}

/** URL einer PPTX-Folie (1-basiert). */
export function slideUrl(mediaId: string, index: number): string {
  return `/api/signage/media/${mediaId}/slide/${index}`;
}

export const signageApi = {
  // --- Tags ---
  listTags: () => request<SignageTag[]>("/tags"),
  createTag: (name: string) =>
    request<SignageTag>("/tags", { method: "POST", body: JSON.stringify({ name }) }),
  renameTag: (id: number, name: string) =>
    request<SignageTag>(`/tags/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteTag: (id: number) => request<null>(`/tags/${id}`, { method: "DELETE" }),

  /** Namen zu IDs auflösen und unbekannte Tags anlegen (wie im Altprojekt). */
  resolveTagIds: async (names: string[]): Promise<number[]> => {
    const existing = await signageApi.listTags();
    const byName = new Map(existing.map((t) => [t.name, t.id]));
    const ids: number[] = [];
    for (const name of names) {
      const known = byName.get(name);
      ids.push(known ?? (await signageApi.createTag(name)).id);
    }
    return ids;
  },

  // --- Medien ---
  listMedia: () => request<SignageMedia[]>("/media"),
  getMedia: (id: string) => request<SignageMedia>(`/media/${id}`),
  createUrlMedia: (body: { kind: "url" | "html"; title: string; uri?: string; html_content?: string }) =>
    request<SignageMedia>("/media", { method: "POST", body: JSON.stringify(body) }),
  uploadMedia: (file: File, title: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    const isPptx = file.name.toLowerCase().endsWith(".pptx");
    return request<SignageMedia>(isPptx ? "/media/pptx" : "/media/upload", {
      method: "POST",
      body: form,
    });
  },
  deleteMedia: (id: string) => request<null>(`/media/${id}`, { method: "DELETE" }),
  reconvertMedia: (id: string) => request<SignageMedia>(`/media/${id}/reconvert`, { method: "POST" }),

  // --- Playlists ---
  listPlaylists: () => request<SignagePlaylist[]>("/playlists"),
  getPlaylist: (id: string) => request<SignagePlaylist>(`/playlists/${id}`),
  createPlaylist: (body: {
    name: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    tag_ids?: number[];
  }) => request<SignagePlaylist>("/playlists", { method: "POST", body: JSON.stringify(body) }),
  updatePlaylist: (
    id: string,
    body: Partial<{
      name: string;
      description: string | null;
      priority: number;
      enabled: boolean;
      tag_ids: number[];
    }>,
  ) => request<SignagePlaylist>(`/playlists/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePlaylist: (id: string) => request<null>(`/playlists/${id}`, { method: "DELETE" }),

  listPlaylistItems: (id: string) => request<SignagePlaylistItem[]>(`/playlists/${id}/items`),
  /** Atomarer Austausch aller Einträge in einer Transaktion. */
  replacePlaylistItems: (
    id: string,
    items: Array<{ media_id: string; position: number; duration_s: number; transition: string | null }>,
  ) =>
    request<SignagePlaylistItem[]>(`/playlists/${id}/items`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),

  // --- Geräte ---
  listDevices: () => request<SignageDevice[]>("/devices"),
  updateDevice: (id: string, body: { name?: string; tag_ids?: number[] }) =>
    request<SignageDevice>(`/devices/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  updateCalibration: (
    id: string,
    body: Partial<{ rotation: 0 | 90 | 180 | 270; hdmi_mode: string | null; audio_enabled: boolean }>,
  ) =>
    request<SignageDevice>(`/devices/${id}/calibration`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteDevice: (id: string) => request<null>(`/devices/${id}`, { method: "DELETE" }),
  reloadDevice: (id: string) =>
    request<SignageDeviceCommandResult>(`/devices/${id}/reload`, { method: "POST" }),
  rebootDevice: (id: string) =>
    request<SignageDeviceCommandResult>(`/devices/${id}/reboot`, { method: "POST" }),
  revokeDevice: (id: string) =>
    request<null>(`/pair/devices/${id}/revoke`, { method: "POST" }),
  listDeviceAnalytics: () => request<SignageDeviceAnalytics[]>("/analytics/devices"),

  // --- Kopplung ---
  claimPairingCode: (body: { code: string; device_name: string; tag_ids: number[] | null }) =>
    request<null>("/pair/claim", { method: "POST", body: JSON.stringify(body) }),

  // --- Zeitpläne ---
  listSchedules: () => request<SignageSchedule[]>("/schedules"),
  createSchedule: (body: {
    playlist_id: string;
    weekday_mask: number;
    start_hhmm: number;
    end_hhmm: number;
    priority?: number;
    enabled?: boolean;
  }) => request<SignageSchedule>("/schedules", { method: "POST", body: JSON.stringify(body) }),
  updateSchedule: (
    id: string,
    body: Partial<{
      playlist_id: string;
      weekday_mask: number;
      start_hhmm: number;
      end_hhmm: number;
      priority: number;
      enabled: boolean;
    }>,
  ) => request<SignageSchedule>(`/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSchedule: (id: string) => request<null>(`/schedules/${id}`, { method: "DELETE" }),
};

/** Query-Keys an einer Stelle, damit Invalidierungen zusammenpassen. */
export const signageKeys = {
  tags: () => ["signage", "tags"] as const,
  media: () => ["signage", "media"] as const,
  mediaItem: (id: string) => ["signage", "media", id] as const,
  playlists: () => ["signage", "playlists"] as const,
  playlistEditor: (id: string) => ["signage", "playlists", id, "editor"] as const,
  devices: () => ["signage", "devices"] as const,
  deviceAnalytics: () => ["signage", "devices", "analytics"] as const,
  schedules: () => ["signage", "schedules"] as const,
};
