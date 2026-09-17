import { headers } from "next/headers";

/**
 * Die Adresse, unter der **der Browser** Supabase erreicht.
 *
 * Alles läuft same-origin über den Caddy: die Seite, `/supabase` und
 * `/compute`. Woher der Browser kommt, weiß nur die Anfrage — steht in
 * `SUPABASE_PUBLIC_URL` `http://localhost/supabase`, dann zeigt das für jeden
 * anderen Rechner im Netz auf ihn selbst, und keine Abfrage kommt an. Genau so
 * fiel es auf: die Seite lud, die Daten nicht.
 *
 * Deshalb zählt der Host der Anfrage, und aus der Einstellung bleibt nur der
 * **Pfad** (`/supabase`) — der ist Teil des Aufbaus, nicht der Umgebung. Ohne
 * Host-Kopf bleibt die Einstellung, wie sie ist.
 *
 * Der Aussteller im Token (`API_EXTERNAL_URL`) ist davon unberührt: den prüft
 * `compute`, er gehört zur Anmeldung und nicht zum Weg des Browsers.
 */
export function oeffentlicheAdresse(
  konfiguriert: string | undefined,
  host: string | null,
  protokoll: string | null,
): string {
  if (!konfiguriert) return "";
  if (!host) return konfiguriert;
  let pfad = "";
  try {
    pfad = new URL(konfiguriert).pathname.replace(/\/$/, "");
  } catch {
    // Keine vollständige Adresse in der Einstellung — dann taugt sie auch
    // nicht als Rückfall.
    return konfiguriert;
  }
  // Caddy hängt bei mehreren Sprüngen an, der erste Eintrag ist der des
  // Browsers.
  const schema = (protokoll ?? "http").split(",")[0].trim() || "http";
  return `${schema}://${host}${pfad}`;
}

/** Wie `oeffentlicheAdresse`, mit den Kopfzeilen der laufenden Anfrage. */
export async function oeffentlicheAdresseAusAnfrage(): Promise<string> {
  const kopf = await headers();
  return oeffentlicheAdresse(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    kopf.get("x-forwarded-host") ?? kopf.get("host"),
    kopf.get("x-forwarded-proto"),
  );
}
