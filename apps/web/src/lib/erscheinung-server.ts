import { createClient } from "@/lib/supabase/server";
import { STANDARD_ERSCHEINUNG, cssVariablen, erscheinungAus, type Erscheinung } from "@/lib/kontrast";

/**
 * App-Name und Farbrollen für den Server (SET-06).
 *
 * Beides steht in `plattform_einstellungen`. Gelesen wird über die Funktion
 * `plattform_erscheinung()` — die gibt es auch für `anon`, damit die
 * Anmeldeseite Name und Farben zeigt, ohne die ganze Zeile offenzulegen.
 *
 * Die Farben gehen als CSS-Variablen in den Dokumentkopf, noch vor dem ersten
 * Bild: so blitzt beim Laden nicht die Standardfarbe auf. Ist nichts
 * hinterlegt, gilt die Vorgabe aus `globals.css` — dann muss gar nichts
 * eingesetzt werden.
 */
export interface ErscheinungStand {
  appName: string;
  erscheinung: Erscheinung;
  /** `null`, wenn die Vorgabe gilt — dann kein zusätzliches Stylesheet nötig. */
  css: string | null;
}

export async function ladeErscheinung(): Promise<ErscheinungStand> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("plattform_erscheinung");
    const roh = (data ?? {}) as { app_name?: unknown; farben?: unknown };
    const appName =
      typeof roh.app_name === "string" && roh.app_name.trim() ? roh.app_name : "ACM-Plattform";
    const eigene = roh.farben != null;
    const erscheinung = eigene ? erscheinungAus(roh.farben) : STANDARD_ERSCHEINUNG;
    return { appName, erscheinung, css: eigene ? cssVariablen(erscheinung) : null };
  } catch {
    // Ohne Datenbank (Build, Ausfall) gilt die Vorgabe.
    return { appName: "ACM-Plattform", erscheinung: STANDARD_ERSCHEINUNG, css: null };
  }
}
