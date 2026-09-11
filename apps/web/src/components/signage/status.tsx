"use client";

import { Badge } from "@/components/ui/primitives";
import { minutesSince } from "@/lib/signage/schedule";
import type { SignageConversionStatus, SignageDeviceAnalytics } from "@/lib/signage/types";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Gerätestatus aus `last_seen_at` abgeleitet (Schwellen wie im Altprojekt):
 * unter 2 min online, unter 5 min Warnung, darüber offline, ohne Wert unbekannt.
 */
export function DeviceStatusBadge({ lastSeenAt }: { lastSeenAt: string | null }) {
  const worte = useTexte();
  const minutes = minutesSince(lastSeenAt);
  if (minutes === null) return <Badge className="status-none">{worte.signage.nieGesehen}</Badge>;
  if (minutes < 2) return <Badge className="status-ok">{worte.signage.online}</Badge>;
  if (minutes < 5) return <Badge className="status-warn">{worte.signage.vorMinuten(minutes)}</Badge>;
  return <Badge className="status-bad">{worte.signage.offline}</Badge>;
}

/** Verfügbarkeit und verpasste Fenster; Farbstufen ab 95 % und 80 %. */
export function UptimeBadge({
  variant,
  data,
}: {
  variant: "uptime" | "missed";
  data: SignageDeviceAnalytics | undefined;
}) {
  const worte = useTexte();
  if (!data || data.uptime_24h_pct === null) {
    return (
      <span title={worte.signage.keineHeartbeats}>
        <Badge className="status-none">—</Badge>
      </span>
    );
  }
  const pct = data.uptime_24h_pct;
  const cls = pct >= 95 ? "status-ok" : pct >= 80 ? "status-warn" : "status-bad";
  const partial = data.window_minutes < 1440;
  const windowH = Math.ceil(data.window_minutes / 60);
  const buckets = data.window_minutes - data.missed_windows_24h;
  const tooltip =
    variant === "uptime"
      ? `${buckets} von ${data.window_minutes} Minuten mit Heartbeat` +
        (partial ? ` (Fenster ${windowH} h, Gerät ist neu)` : "")
      : `${data.missed_windows_24h} Minuten ohne Heartbeat` + (partial ? ` (Fenster ${windowH} h)` : "");
  return (
    <span title={tooltip}>
      <Badge className={cls}>
        {variant === "uptime" ? `${pct.toFixed(1)} %` : String(data.missed_windows_24h)}
      </Badge>
    </span>
  );
}

const CONVERSION_CLASS: Record<SignageConversionStatus, string> = {
  pending: "status-none",
  processing: "status-warn animate-pulse",
  done: "status-ok",
  failed: "status-bad",
};

/** Konvertierungsstatus einer PPTX-Datei. */
export function ConversionBadge({
  status,
  error,
}: {
  status: SignageConversionStatus | null;
  error: string | null;
}) {
  const worte = useTexte();
  const stand: Record<SignageConversionStatus, string> = {
    pending: worte.signage.wartet,
    processing: worte.signage.konvertiert,
    done: worte.signage.fertig,
    failed: worte.signage.fehlgeschlagen,
  };
  if (!status) return null;
  return (
    <span title={status === "failed" && error ? error : undefined}>
      <Badge className={CONVERSION_CLASS[status]}>{stand[status]}</Badge>
    </span>
  );
}
