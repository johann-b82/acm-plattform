/**
 * Typen der Signage-Admin-API (acm-signage, `api/app/schemas/signage.py`).
 * Nur Felder, die das Admin-UI verwendet.
 */

export type SignageMediaKind = "image" | "video" | "pdf" | "pptx" | "url" | "html";
export type SignageConversionStatus = "pending" | "processing" | "done" | "failed";

export interface SignageTag {
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface SignageMedia {
  id: string;
  kind: SignageMediaKind;
  title: string;
  /** Bei Dateien ein relativer Pfad (`files/<uuid>.<ext>`), bei kind=url die URL. */
  uri: string | null;
  html_content: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  conversion_status: SignageConversionStatus | null;
  conversion_error: string | null;
  slide_paths: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface SignageDevice {
  id: string;
  name: string;
  status: "pending" | "online" | "offline";
  last_seen_at: string | null;
  revoked_at: string | null;
  tag_ids: number[] | null;
  current_playlist_id: string | null;
  current_playlist_name: string | null;
  rotation: 0 | 90 | 180 | 270;
  hdmi_mode: string | null;
  audio_enabled: boolean;
  mac_address: string | null;
  hostname: string | null;
  ip_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignagePlaylist {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  tag_ids: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface SignagePlaylistItem {
  id?: string;
  playlist_id?: string;
  media_id: string;
  position: number;
  duration_s: number;
  transition: string | null;
}

export interface SignageSchedule {
  id: string;
  playlist_id: string;
  /** Bit 0 = Montag … Bit 6 = Sonntag. */
  weekday_mask: number;
  /** Ganzzahl in HHMM-Form, z. B. 730 = 07:30. */
  start_hhmm: number;
  end_hhmm: number;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SignageDeviceAnalytics {
  device_id: string;
  /** null, wenn keine Heartbeats vorliegen (Nenner 0). */
  uptime_24h_pct: number | null;
  missed_windows_24h: number;
  window_minutes: number;
}

export interface SignageDeviceCommandResult {
  event: "reload" | "reboot";
  device_id: string;
  /** Live-Abonnenten, die das Ereignis erhalten haben. 0 = niemand verbunden. */
  delivered: number;
}
