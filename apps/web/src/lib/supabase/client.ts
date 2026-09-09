"use client";

import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE } from "./shared";

/**
 * Supabase-Client für den Browser. Liest dieselbe Cookie-Sitzung, die der
 * Server schreibt, und geht same-origin über den Plattform-Caddy an Kong.
 *
 * Adresse und Schlüssel kommen zur Laufzeit vom Server (siehe `Providers`),
 * nicht aus `NEXT_PUBLIC_*`. Next.js setzt solche Werte beim Bauen ein; das
 * Image müsste dann je Umgebung neu gebaut werden. Für eine selbst betriebene
 * Anwendung, die auf mehreren Hosts läuft, ist das der falsche Weg.
 */
let konfig: { url: string; anonKey: string } | null = null;
let client: ReturnType<typeof createBrowserClient> | null = null;

export function setSupabaseKonfig(url: string, anonKey: string): void {
  if (konfig?.url === url && konfig?.anonKey === anonKey) return;
  konfig = { url, anonKey };
  client = null;
}

export function supabaseBrowser() {
  if (!konfig) {
    throw new Error(
      "Supabase-Konfiguration fehlt. Sie wird vom Server über <Providers> gesetzt.",
    );
  }
  if (!client) {
    client = createBrowserClient(konfig.url, konfig.anonKey, {
      cookieOptions: { name: AUTH_COOKIE },
    });
  }
  return client;
}
