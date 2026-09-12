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
  /** Leer heißt: kein Ziel, keine Ziellinie. Nur wo `leer_erlaubt`. */
  wert: number | null;
  einheit: Einheit;
  richtung: Richtung;
  sortierung: number;
  leer_erlaubt: boolean;
  geaendert_am: string;
}

export const BEREICH_LABEL: Record<string, string> = {
  vertrieb: "Vertrieb",
  einkauf: "Einkauf",
  produktion: "Produktion",
  qualitaet: "Qualität",
  finanzen: "Finanzen",
  personal: "HR",
};

export const zielwerteKeys = {
  alle: () => ["zielwerte"] as const,
};

export async function ladeZielwerte(): Promise<Zielwert[]> {
  const { data, error } = await supabaseBrowser()
    .from("zielwerte")
    .select("schluessel,bereich,label,beschreibung,wert,einheit,richtung,sortierung,leer_erlaubt,geaendert_am")
    .order("sortierung");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Zielwert[]).map((z) => ({ ...z, wert: z.wert == null ? null : Number(z.wert) }));
}

/**
 * Zielwert setzen.
 *
 * Das `.select()` ist nicht schmückendes Beiwerk: weist die Policy die
 * Änderung ab, meldet Postgres `UPDATE 0` — kein Fehler, nur null Zeilen.
 * PostgREST reicht das als Erfolg durch, und die Oberfläche sagte
 * „Gespeichert", während sich nichts geändert hat. Mit `.select()` kommen
 * die geänderten Zeilen zurück, und eine leere Antwort ist die Absage.
 */
export async function setzeZielwert(schluessel: string, wert: number | null): Promise<void> {
  const { data, error } = await supabaseBrowser()
    .from("zielwerte")
    .update({ wert, geaendert_am: new Date().toISOString() })
    .eq("schluessel", schluessel)
    .select("schluessel");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("Nicht gespeichert — fehlt das Recht, Einstellungen zu bearbeiten?");
  }
}

/** Aus einer Liste eine Nachschlagetabelle machen. Leere Zielwerte fehlen darin
 *  — für die Kacheln ist „kein Ziel“ dasselbe wie „nicht eingetragen“. */
export function nachSchluessel(zielwerte: readonly Zielwert[]): Record<string, number> {
  return Object.fromEntries(
    zielwerte.flatMap((z) => (z.wert == null ? [] : [[z.schluessel, z.wert] as const])),
  );
}

/** Eingabefeld → Zielwert. Leer ergibt `null`, aber nur wo leer erlaubt ist. */
export function zielwertAusEingabe(
  roh: string,
  einheit: Einheit,
  leerErlaubt: boolean,
): number | null | "ungueltig" {
  const text = roh.trim();
  if (text === "") return leerErlaubt ? null : "ungueltig";
  const zahl = Number(text.replace(",", "."));
  if (!Number.isFinite(zahl) || zahl < 0) return "ungueltig";
  return ausAnzeige(zahl, einheit);
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
