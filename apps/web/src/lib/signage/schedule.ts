/**
 * Reine Umrechnungen für Zeitpläne. Bitposition 0 = Montag … 6 = Sonntag,
 * Zeiten als Ganzzahl HHMM (0..2359). Übernommen aus lumeapps
 * (`src/signage/lib/scheduleAdapters.ts`) samt Randfällen.
 */

export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

export function weekdayMaskToArray(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, i) => ((mask >> i) & 1) === 1);
}

export function weekdayMaskFromArray(arr: boolean[]): number {
  return arr.reduce((m, on, i) => (on ? m | (1 << i) : m), 0);
}

/** "HH:MM" (24h) → HHMM-Ganzzahl; null bei leer, falschem Format oder außerhalb. */
export function hhmmFromString(s: string): number | null {
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

/** HHMM-Ganzzahl → "HH:MM"; "" bei ungültigen Werten (auch mm > 59). */
export function hhmmToString(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 2359) return "";
  const hh = Math.floor(n / 100);
  const mm = n % 100;
  if (mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Kurzform der aktiven Tage, z. B. "Mo–Fr" oder "Mo, Mi, Fr". */
export function weekdaysLabel(mask: number): string {
  const days = weekdayMaskToArray(mask);
  const active = days.flatMap((on, i) => (on ? [i] : []));
  if (active.length === 0) return "—";
  if (active.length === 7) return "täglich";
  const isRun = active.every((d, i) => i === 0 || d === active[i - 1] + 1);
  if (isRun && active.length > 2) {
    return `${WEEKDAY_LABELS[active[0]]}–${WEEKDAY_LABELS[active[active.length - 1]]}`;
  }
  return active.map((d) => WEEKDAY_LABELS[d]).join(", ");
}

/** Relative Zeitangabe ohne Zusatzabhängigkeit (Intl.RelativeTimeFormat). */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const fmt = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.34],
    ["month", 12],
  ];
  let value = diffSeconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return fmt.format(Math.round(value), unit);
    value /= size;
  }
  return fmt.format(Math.round(value), "year");
}

/** Minuten seit dem letzten Heartbeat; null, wenn nie gesehen. */
export function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 60_000);
}
