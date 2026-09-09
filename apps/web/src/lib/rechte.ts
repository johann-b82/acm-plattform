/**
 * Das Rechtemodell als reine Daten und Funktionen.
 *
 * Bewusst ohne `next/headers` und ohne Supabase-Client: sowohl der Server
 * (`@/lib/auth`) als auch Client-Komponenten brauchen diese Stufen, und ein
 * Server-Import würde den Server-Code in das Browser-Bundle ziehen.
 */

export const LEVELS = ["viewer", "editor", "admin"] as const;
export type Level = (typeof LEVELS)[number];
export type Apps = Record<string, Level>;

/** Level des Nutzers für eine App; Plattform-Admins haben überall `admin`. */
export function levelFor(apps: Apps, app: string): Level | null {
  if (apps.platform === "admin") return "admin";
  return apps[app] ?? null;
}

export function hasLevel(apps: Apps, app: string, level: Level = "viewer"): boolean {
  const mine = levelFor(apps, app);
  return mine !== null && LEVELS.indexOf(mine) >= LEVELS.indexOf(level);
}
