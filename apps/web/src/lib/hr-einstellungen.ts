import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Einstellungen des Personalmoduls, die keine Zielwerte sind: welche
 * Personio-Abwesenheitsarten als Krankheit zählen und welche Abteilungen zur
 * Produktion gehören.
 *
 * Eine Zeile je Schlüssel mit einem Textfeld-Array — nicht ein breites
 * Singleton wie im Altprojekt, wo jede neue Einstellung eine Spalte war.
 */

export interface HrEinstellung {
  schluessel: string;
  beschreibung: string;
  werte: string[];
}

export const hrEinstellungKeys = {
  alle: () => ["hr-einstellungen"] as const,
};

export async function ladeHrEinstellungen(): Promise<HrEinstellung[]> {
  const { data, error } = await supabaseBrowser()
    .from("hr_einstellungen")
    .select("schluessel,beschreibung,werte")
    .order("schluessel");
  if (error) throw new Error(error.message);
  return (data ?? []) as HrEinstellung[];
}

/** Siehe `setzeZielwert`: ohne `.select()` wäre eine von der Policy
 *  abgewiesene Änderung von einer erfolgreichen nicht zu unterscheiden. */
export async function setzeHrEinstellung(schluessel: string, werte: string[]): Promise<void> {
  const { data, error } = await supabaseBrowser()
    .from("hr_einstellungen")
    .update({ werte, geaendert_am: new Date().toISOString() })
    .eq("schluessel", schluessel)
    .select("schluessel");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("Nicht gespeichert — fehlt das Recht, Einstellungen zu bearbeiten?");
  }
}

/** Freitext zu Werten: Komma oder Zeilenumbruch trennen, Leeres fällt weg. */
export function ausFreitext(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function alsFreitext(werte: string[]): string {
  return werte.join(", ");
}

export const HR_LABEL: Record<string, string> = {
  krank_typ_ids: "Abwesenheitsarten, die als Krankheit zählen",
  produktion_abteilungen: "Abteilungen der Produktion",
};
