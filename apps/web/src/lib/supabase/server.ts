import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AUTH_COOKIE } from "./shared";

/**
 * Server-seitiger Supabase-Client (Server Components, Server Actions, Route Handlers).
 * Spricht Kong direkt im Compose-Netz; der Browser geht über /supabase am Caddy.
 */
export { AUTH_COOKIE } from "./shared";

export function supabaseInternalUrl(): string {
  return process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseInternalUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: AUTH_COOKIE },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // In Server Components ist Schreiben verboten; proxy.ts hält die Session frisch.
        }
      },
    },
  });
}
