import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const LEVELS = ["viewer", "editor", "admin"] as const;
export type Level = (typeof LEVELS)[number];
export type Apps = Record<string, Level>;

export type Session = {
  userId: string;
  email: string | null;
  apps: Apps;
};

/** Level des Nutzers für eine App; Plattform-Admins haben überall `admin`. */
export function levelFor(apps: Apps, app: string): Level | null {
  if (apps.platform === "admin") return "admin";
  return apps[app] ?? null;
}

export function hasLevel(apps: Apps, app: string, level: Level = "viewer"): boolean {
  const mine = levelFor(apps, app);
  return mine !== null && LEVELS.indexOf(mine) >= LEVELS.indexOf(level);
}

/**
 * Data-Access-Layer-Einstieg: liest die geprüften Claims (getClaims validiert
 * das Token gegen GoTrue bzw. JWKS) und den Claim `apps` aus dem Token-Hook.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const claims = data.claims as Record<string, unknown>;
  const apps = (claims.apps && typeof claims.apps === "object" ? claims.apps : {}) as Apps;
  return {
    userId: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    apps,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireApp(app: string, level: Level = "viewer"): Promise<Session> {
  const session = await requireSession();
  if (!hasLevel(session.apps, app, level)) redirect("/?denied=" + encodeURIComponent(app));
  return session;
}
