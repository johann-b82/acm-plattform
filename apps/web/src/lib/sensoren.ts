import { supabaseBrowser } from "@/lib/supabase/client";
import { computeJson } from "@/lib/compute";

/**
 * Sensoren: Temperatur und Luftfeuchte aus dem Netz.
 *
 * Gelesen wird über PostgREST — die Community gibt das Spaltenrecht gar nicht
 * erst frei, deshalb steht sie in keiner Antwort. Angelegt und geändert wird
 * über `compute`: jede Änderung kann die Community tragen, und die zu
 * verschlüsseln braucht den Schlüssel aus der Umgebung.
 */

export interface Sensor {
  id: string;
  name: string;
  rechner: string;
  port: number;
  temperatur_oid: string | null;
  feuchte_oid: string | null;
  temperatur_faktor: string;
  feuchte_faktor: string;
  temperatur_min: string | null;
  temperatur_max: string | null;
  feuchte_min: string | null;
  feuchte_max: string | null;
  aktiv: boolean;
  farbe: string | null;
}

export interface Stand {
  sensor_id: string;
  gemessen_am: string | null;
  temperatur: string | null;
  feuchte: string | null;
  versucht_am: string | null;
  erfolg: boolean | null;
  fehler: string | null;
}

export interface Messung {
  sensor_id: string;
  gemessen_am: string;
  temperatur: string | null;
  feuchte: string | null;
}

export interface Probe {
  erreichbar: boolean;
  temperatur: number | null;
  feuchte: number | null;
  meldung: string | null;
}

export interface MessLauf {
  gemessen: number;
  gescheitert: number;
  hinweise: string[];
}

const FELDER =
  "id,name,rechner,port,temperatur_oid,feuchte_oid,temperatur_faktor," +
  "feuchte_faktor,temperatur_min,temperatur_max,feuchte_min,feuchte_max," +
  "aktiv,farbe";

/** Die Zeitfenster des Verlaufs. Mehr als eine Woche wird unleserlich. */
export const FENSTER = [
  { stunden: 6, label: "6 h" },
  { stunden: 24, label: "24 h" },
  { stunden: 72, label: "3 Tage" },
  { stunden: 168, label: "7 Tage" },
] as const;

export const sensorKeys = {
  liste: () => ["sensoren", "liste"] as const,
  stand: () => ["sensoren", "stand"] as const,
  verlauf: (stunden: number) => ["sensoren", "verlauf", stunden] as const,
};

/** Die Palette, wenn ein Gerät keine eigene Farbe trägt. */
export const PALETTE = ["#0f6e8c", "#b4532a", "#3f7a4b", "#7a4b8c", "#8c7a2a"];

export function farbeVon(sensor: Sensor, index: number): string {
  return sensor.farbe ?? PALETTE[index % PALETTE.length];
}

/** Liegt der Wert außerhalb der Grenzen dieses Geräts? */
export function ausserhalb(
  wert: number | null,
  min: string | null,
  max: string | null,
): boolean {
  if (wert === null || !Number.isFinite(wert)) return false;
  if (min !== null && wert < Number(min)) return true;
  if (max !== null && wert > Number(max)) return true;
  return false;
}

/**
 * Wie frisch ist der Stand? Ein Gerät, das seit vier Ausfällen des
 * Fünf-Minuten-Takts nichts gemeldet hat, gilt als offline — vorher ist es
 * nur „ein Takt ausgelassen", und das kommt bei UDP vor.
 */
export type Zustand = "frisch" | "verzoegert" | "offline" | "unbekannt";

export function zustand(stand: Stand | undefined, jetzt = Date.now()): Zustand {
  if (!stand?.gemessen_am) return "unbekannt";
  const alter = (jetzt - new Date(stand.gemessen_am).getTime()) / 60000;
  if (alter <= 11) return "frisch";
  if (alter <= 20) return "verzoegert";
  return "offline";
}

export const sensorApi = {
  liste: async (): Promise<Sensor[]> => {
    const { data, error } = await supabaseBrowser()
      .from("sensoren")
      .select(FELDER)
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Sensor[];
  },

  stand: async (): Promise<Stand[]> => {
    const { data, error } = await supabaseBrowser().from("sensor_stand").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Stand[];
  },

  verlauf: async (stunden: number): Promise<Messung[]> => {
    const ab = new Date(Date.now() - stunden * 3600_000).toISOString();
    const { data, error } = await supabaseBrowser()
      .from("sensor_messungen")
      .select("sensor_id,gemessen_am,temperatur,feuchte")
      .gte("gemessen_am", ab)
      .order("gemessen_am");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Messung[];
  },

  anlegen: async (felder: Record<string, unknown>): Promise<void> => {
    await computeJson("/api/sensoren", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(felder),
    });
  },

  aendern: async (id: string, felder: Record<string, unknown>): Promise<void> => {
    await computeJson(`/api/sensoren/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(felder),
    });
  },

  loeschen: async (id: string): Promise<void> => {
    await computeJson(`/api/sensoren/${id}`, { method: "DELETE" });
  },

  probe: async (felder: Record<string, unknown>): Promise<Probe> =>
    computeJson<Probe>("/api/sensoren/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(felder),
    }),

  messen: async (): Promise<MessLauf> =>
    computeJson<MessLauf>("/api/sensoren/messen", { method: "POST" }),
};
