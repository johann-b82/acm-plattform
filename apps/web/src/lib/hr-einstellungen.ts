import { computeJson } from "@/lib/compute";
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

/**
 * Was zur Auswahl steht, statt abgetippt zu werden.
 *
 * Abteilungen und Feldnamen holt compute aus dem abgeglichenen Bestand,
 * die Abwesenheits*arten* live von Personio — die werden nicht abgeglichen und
 * stehen in keiner Tabelle. Fällt Personio aus, kommt trotzdem eine Antwort;
 * `hinweis` sagt dann, warum die Arten aus dem Bestand stammen.
 */
export interface Auswahllisten {
  abwesenheitsarten: { id: number; name: string }[];
  abteilungen: string[];
  felder: string[];
  hinweis: string | null;
  arten_aus_bestand: boolean;
}

export const hrEinstellungKeys = {
  alle: () => ["hr-einstellungen"] as const,
  listen: () => ["hr-einstellungen", "listen"] as const,
};

export function ladeAuswahllisten(): Promise<Auswahllisten> {
  return computeJson<Auswahllisten>("/api/hr/listen");
}

/** Welche Liste gehört zu welcher Einstellung? Leer heißt: nur Freitext. */
export function vorschlaege(
  schluessel: string,
  listen: Auswahllisten | undefined,
): { wert: string; label: string }[] {
  if (!listen) return [];
  if (schluessel === "krank_typ_ids") {
    return listen.abwesenheitsarten.map((a) => ({
      wert: String(a.id),
      label: `${a.name} (${a.id})`,
    }));
  }
  if (schluessel === "produktion_abteilungen") {
    return listen.abteilungen.map((a) => ({ wert: a, label: a }));
  }
  if (schluessel === "kompetenz_attribute") {
    return listen.felder.map((f) => ({ wert: f, label: f }));
  }
  return [];
}

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
  kompetenz_attribute: "Personio-Felder, die als gepflegte Kompetenz zählen",
};
