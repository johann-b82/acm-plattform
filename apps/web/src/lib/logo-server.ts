import { LOGO_EIMER } from "@/lib/logo-gemeinsam";
import { createClient, supabaseInternalUrl } from "@/lib/supabase/server";

/**
 * Die Adresse des Firmenlogos für die Kopfzeile — serverseitig geholt.
 *
 * Warum nicht im Browser wie in der Einstellungsmaske: die Kopfzeile steht auf
 * jeder Seite. Zwei zusätzliche Abfragen beim ersten Bild und ein kurzes
 * Aufblitzen des Schriftzugs, bevor das Logo einspringt — für etwas, das ohnehin
 * schon mit der Seite kommen kann.
 *
 * Der Eimer ist nicht öffentlich; die Adresse wird deshalb signiert. Eine Stunde
 * Gültigkeit, nicht fünf Minuten wie in der Maske: ein Bild in der Kopfzeile
 * soll nicht alle paar Minuten neu geladen werden.
 */
export async function logoAdresse(sekunden = 3600): Promise<string | null> {
  const supabase = await createClient();

  const { data: zeile } = await supabase
    .from("plattform_logo")
    .select("pfad")
    .maybeSingle();
  const pfad = (zeile as { pfad: string | null } | null)?.pfad;
  if (!pfad) return null;

  const { data, error } = await supabase.storage
    .from(LOGO_EIMER)
    .createSignedUrl(pfad, sekunden);
  if (error || !data?.signedUrl) return null;

  // Der Server spricht Kong direkt im Compose-Netz an, der Browser geht über
  // den Caddy. Die signierte Adresse trägt deshalb den **internen** Namen und
  // löste im Browser nicht auf. Der Token bleibt gültig — signiert ist der
  // Pfad, nicht der Host.
  const intern = supabaseInternalUrl();
  const oeffentlich = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (oeffentlich && data.signedUrl.startsWith(intern)) {
    return oeffentlich + data.signedUrl.slice(intern.length);
  }
  return data.signedUrl;
}
