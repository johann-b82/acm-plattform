"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeServerFetch } from "@/lib/compute-server";

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "E-Mail und Passwort eingeben." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Anmeldung fehlgeschlagen. E-Mail oder Passwort prüfen." };
  redirect("/");
}

/**
 * Anmeldung über das lokale AD (ADR-0004, Weg LDAPS).
 *
 * `compute` prüft Benutzer+Passwort per LDAPS-Bind und gibt ein Einmalpasswort
 * zurück — das bleibt auf dem Server; damit meldet sich der Web-Server bei
 * Supabase an und setzt das Cookie. Der Browser sieht das Einmalpasswort nie.
 */
export async function signInAd(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const benutzer = String(formData.get("benutzer") ?? "").trim();
  const passwort = String(formData.get("password") ?? "");
  if (!benutzer || !passwort) return { error: "Benutzer und Passwort eingeben." };

  let email: string;
  let einmalpasswort: string;
  try {
    const antwort = await computeServerFetch("/api/anmeldung/ad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ benutzer, passwort }),
    });
    if (antwort.status === 401) return { error: "Benutzer oder Passwort falsch." };
    if (antwort.status === 503) return { error: "Verzeichnisdienst nicht erreichbar. Bitte später erneut." };
    if (!antwort.ok) return { error: "Anmeldung fehlgeschlagen." };
    ({ email, einmalpasswort } = await antwort.json());
  } catch {
    return { error: "Anmeldung fehlgeschlagen." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: einmalpasswort });
  if (error) return { error: "Anmeldung fehlgeschlagen." };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
