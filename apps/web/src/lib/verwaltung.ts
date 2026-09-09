import { supabaseBrowser } from "@/lib/supabase/client";
import { computeJson } from "@/lib/compute";
import type { Level } from "@/lib/rechte";

/**
 * Rechteverwaltung: Gruppen, Mitglieder, App-Rechte.
 *
 * Alles läuft über PostgREST. Schreiben darf nur, wer `platform: admin` hat —
 * das steht als Policy an den Tabellen (Alembic 0001), nicht im Frontend. Die
 * Oberfläche blendet die Bedienelemente aus, die Datenbank entscheidet.
 */

export interface App {
  id: string;
  name: string;
  path: string;
  sort: number;
}

export interface Gruppe {
  id: string;
  name: string;
  source: "manual" | "ad";
  external_id: string | null;
  synced_at: string | null;
  created_at: string;
}

export interface Recht {
  group_id: string;
  app_id: string;
  level: Level;
}

export interface Mitgliedschaft {
  user_id: string;
  group_id: string;
}

export interface AngelegterNutzer {
  id: string;
  email: string;
  passwort: string;
}

export interface Nutzer {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
}

function sb() {
  return supabaseBrowser();
}

async function auswerten<T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export const verwaltungApi = {
  apps: () => auswerten<App[]>(sb().from("apps").select("id,name,path,sort").order("sort")),
  gruppen: () =>
    auswerten<Gruppe[]>(
      sb().from("groups").select("id,name,source,external_id,synced_at,created_at").order("name"),
    ),
  rechte: () => auswerten<Recht[]>(sb().from("app_grants").select("group_id,app_id,level")),
  mitgliedschaften: () =>
    auswerten<Mitgliedschaft[]>(sb().from("user_groups").select("user_id,group_id")),
  nutzer: () =>
    auswerten<Nutzer[]>(
      sb()
        .from("plattform_nutzer")
        .select("id,email,created_at,last_sign_in_at")
        .order("email"),
    ),

  gruppeAnlegen: (name: string) =>
    auswerten<Gruppe[]>(sb().from("groups").insert({ name }).select("id,name,source,external_id,synced_at,created_at")),
  gruppeUmbenennen: (id: string, name: string) =>
    auswerten<unknown>(sb().from("groups").update({ name }).eq("id", id)),
  gruppeLoeschen: (id: string) => auswerten<unknown>(sb().from("groups").delete().eq("id", id)),

  /** Recht setzen oder ändern; `null` entfernt es. */
  rechtSetzen: async (group_id: string, app_id: string, level: Level | null) => {
    if (level === null) {
      return auswerten<unknown>(
        sb().from("app_grants").delete().eq("group_id", group_id).eq("app_id", app_id),
      );
    }
    return auswerten<unknown>(
      sb().from("app_grants").upsert({ group_id, app_id, level }, { onConflict: "group_id,app_id" }),
    );
  },

  /**
   * Person anlegen. Geht über compute, nicht über PostgREST: dafür braucht es
   * die Admin-Schnittstelle der Anmeldung und damit einen Schlüssel, der den
   * Browser nie erreichen darf.
   */
  nutzerAnlegen: (email: string) =>
    computeJson<AngelegterNutzer>("/api/verwaltung/nutzer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),

  /** Neues Passwort setzen; die Antwort zeigt es genau einmal. */
  passwortZuruecksetzen: (user_id: string) =>
    computeJson<{ id: string; passwort: string }>(
      `/api/verwaltung/nutzer/${user_id}/passwort`,
      { method: "POST" },
    ),

  mitgliedHinzufuegen: (group_id: string, user_id: string) =>
    auswerten<unknown>(sb().from("user_groups").insert({ group_id, user_id })),
  mitgliedEntfernen: (group_id: string, user_id: string) =>
    auswerten<unknown>(
      sb().from("user_groups").delete().eq("group_id", group_id).eq("user_id", user_id),
    ),
};

export const verwaltungKeys = {
  apps: () => ["verwaltung", "apps"] as const,
  gruppen: () => ["verwaltung", "gruppen"] as const,
  rechte: () => ["verwaltung", "rechte"] as const,
  mitgliedschaften: () => ["verwaltung", "mitgliedschaften"] as const,
  nutzer: () => ["verwaltung", "nutzer"] as const,
};

export const LEVEL_LABEL: Record<Level, string> = {
  viewer: "Ansehen",
  editor: "Bearbeiten",
  admin: "Verwalten",
};
