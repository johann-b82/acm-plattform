"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Aufrufe an den Compute-Dienst (`/api/*` am selben Caddy).
 *
 * compute prüft ein Bearer-Token, der Browser hat aber eine Cookie-Sitzung.
 * Das Token kommt deshalb aus der Supabase-Sitzung; `getSession` erneuert es
 * bei Bedarf selbst.
 *
 * Kein Proxy über die Web-App wie bei Signage: compute läuft am selben Origin
 * hinter demselben Caddy. Ein zweiter Sprung würde bei großen Dateien nur
 * Speicher kosten.
 */
export async function computeFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabaseBrowser().auth.getSession();
  const headers = new Headers(init?.headers);
  const token = data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

/** Wie `computeFetch`, wirft aber bei Fehlerstatus mit der Meldung des Dienstes. */
export async function computeJson<T>(path: string, init?: RequestInit): Promise<T> {
  const antwort = await computeFetch(path, init);
  const body = await antwort.json().catch(() => null);
  if (!antwort.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : `HTTP ${antwort.status}`;
    throw new Error(detail);
  }
  return body as T;
}
