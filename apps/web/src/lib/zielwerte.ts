import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Zielwerte der Kennzahlen. Tabelle und Rechte in Alembic 0007.
 *
 * Anteile stehen als Bruch in der Datenbank (0.98 = 98 %). Die Umrechnung in
 * Prozent passiert hier, an genau einer Stelle — sonst erfindet sie jedes
 * Dashboard neu und irgendwann falsch.
 */

export type Einheit = "anzahl" | "anteil";
export type Richtung = "min" | "max";

export interface Zielwert {
  schluessel: string;
  bereich: string;
  label: string;
  beschreibung: string | null;
  wert: number;
  einheit: Einheit;
  richtung: Richtung;
  sortierung: number;
  geaendert_am: string;
}

export const BEREICH_LABEL: Record<string, string> = {
  vertrieb: "Vertrieb",
  einkauf: "Einkauf",
  produktion: "Produktion",
  qualitaet: "Qualität",
};

export const zielwerteKeys = {
  alle: () => ["zielwerte"] as const,
};

export async function ladeZielwerte(): Promise<Zielwert[]> {
  const { data, error } = await supabaseBrowser()
    .from("zielwerte")
    .select("schluessel,bereich,label,beschreibung,wert,einheit,richtung,sortierung,geaendert_am")
    .order("sortierung");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Zielwert[]).map((z) => ({ ...z, wert: Number(z.wert) }));
}

export async function setzeZielwert(schluessel: string, wert: number): Promise<void> {
  const { error } = await supabaseBrowser()
    .from("zielwerte")
    .update({ wert, geaendert_am: new Date().toISOString() })
    .eq("schluessel", schluessel);
  if (error) throw new Error(error.message);
}

/** Aus einer Liste eine Nachschlagetabelle machen. */
export function nachSchluessel(zielwerte: readonly Zielwert[]): Record<string, number> {
  return Object.fromEntries(zielwerte.map((z) => [z.schluessel, z.wert]));
}

/** Anzeigewert: Anteile als Prozent, Anzahlen unverändert. */
export function alsAnzeige(wert: number, einheit: Einheit): number {
  return einheit === "anteil" ? Math.round(wert * 1000) / 10 : wert;
}

/** Gegenrichtung zu `alsAnzeige`. */
export function ausAnzeige(anzeige: number, einheit: Einheit): number {
  return einheit === "anteil" ? anzeige / 100 : anzeige;
}

/** Ist der gemessene Wert schlechter als das Ziel? */
export function verfehlt(
  gemessen: number | null | undefined,
  ziel: number | undefined,
  richtung: Richtung,
): boolean {
  if (gemessen == null || ziel == null) return false;
  return richtung === "min" ? gemessen < ziel : gemessen > ziel;
}
