import { supabaseBrowser } from "@/lib/supabase/client";
import { computeJson } from "@/lib/compute";

/**
 * Sensoren: Temperatur und Luftfeuchte aus dem Netz.
 *
 * Gelesen wird über PostgREST — die Community gibt das Spaltenrecht gar nicht
 * erst frei, deshalb steht sie in keiner Antwort. Angelegt und geändert wird
 * über `compute`: jede Änderung kann die Community tragen, und die zu
 * verschlüsseln braucht den Schlüssel aus der Umgebung.
 *
 * Takt und Grenzen gelten für alle Geräte und stehen in
 * `sensor_einstellungen` (SET-10/SET-11). Die Grenzspalten am Gerät gibt es
 * noch, ausgewertet werden sie nicht mehr.
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

/** Ein verdichteter Punkt im Verlauf: Mittel über fünf Minuten oder eine Stunde. */
export interface Messung {
  sensor_id: string;
  zeit: string;
  temperatur: string | null;
  feuchte: string | null;
}

/** Min/Max im Fenster und die Änderung zu vor 1 h und 24 h, je Gerät. */
export interface Kennzahlen {
  sensor_id: string;
  gemessen_am: string | null;
  temperatur: string | null;
  feuchte: string | null;
  temperatur_min: string | null;
  temperatur_max: string | null;
  feuchte_min: string | null;
  feuchte_max: string | null;
  temperatur_aenderung_1h: string | null;
  temperatur_aenderung_24h: string | null;
  feuchte_aenderung_1h: string | null;
  feuchte_aenderung_24h: string | null;
}

export interface SensorEinstellungen {
  abfrage_sekunden: number;
  temperatur_min: number | null;
  temperatur_max: number | null;
  feuchte_min: number | null;
  feuchte_max: number | null;
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
  "feuchte_faktor,aktiv,farbe";

/** Die Zeitfenster des Verlaufs in Stunden: 1 h bis 30 Tage (SEN-03/SEN-04). */
export const FENSTER = [1, 6, 24, 72, 168, 720] as const;

export const sensorKeys = {
  liste: () => ["sensoren", "liste"] as const,
  stand: () => ["sensoren", "stand"] as const,
  verlauf: (stunden: number) => ["sensoren", "verlauf", stunden] as const,
  kennzahlen: (stunden: number) => ["sensoren", "kennzahlen", stunden] as const,
  einstellungen: () => ["sensoren", "einstellungen"] as const,
};

/** Die Palette, wenn ein Gerät keine eigene Farbe trägt. */
export const PALETTE = ["#0f6e8c", "#b4532a", "#3f7a4b", "#7a4b8c", "#8c7a2a"];

export function farbeVon(sensor: Sensor, index: number): string {
  return sensor.farbe ?? PALETTE[index % PALETTE.length];
}

/** Liegt der Wert außerhalb der globalen Grenzen? */
export function ausserhalb(
  wert: number | null,
  min: number | string | null,
  max: number | string | null,
): boolean {
  if (wert === null || !Number.isFinite(wert)) return false;
  if (min !== null && wert < Number(min)) return true;
  if (max !== null && wert > Number(max)) return true;
  return false;
}

/**
 * Wie frisch ist der Stand? Gemessen am eingestellten Takt: bis zu zwei
 * Takten (plus eine Minute, weil `pg_cron` minütlich klopft) ist das normal,
 * bis vier Takte „verzögert" — ein ausgelassener Takt kommt bei UDP vor.
 * Danach offline.
 */
export type Zustand = "frisch" | "verzoegert" | "offline" | "unbekannt";

export function zustand(
  stand: Stand | undefined,
  taktSekunden: number,
  jetzt = Date.now(),
): Zustand {
  if (!stand?.gemessen_am) return "unbekannt";
  const alter = (jetzt - new Date(stand.gemessen_am).getTime()) / 1000;
  if (alter <= 2 * taktSekunden + 60) return "frisch";
  if (alter <= 4 * taktSekunden) return "verzoegert";
  return "offline";
}

/** Die Einstellungsmaske hält Text; so wird daraus, was gespeichert wird. */
export type EinstellungsEntwurf = Record<keyof SensorEinstellungen, string>;
export type EinstellungsFehler = "intervall" | "temperatur" | "feuchte" | "zahl";

function alsZahl(text: string): number | null {
  const roh = text.trim().replace(",", ".");
  return roh === "" ? null : Number(roh);
}

export function einstellungenAusEntwurf(entwurf: EinstellungsEntwurf): SensorEinstellungen {
  return {
    abfrage_sekunden: Number(entwurf.abfrage_sekunden.trim()),
    temperatur_min: alsZahl(entwurf.temperatur_min),
    temperatur_max: alsZahl(entwurf.temperatur_max),
    feuchte_min: alsZahl(entwurf.feuchte_min),
    feuchte_max: alsZahl(entwurf.feuchte_max),
  };
}

/** Dieselben Regeln wie an der Tabelle — die Maske sagt es vor dem Speichern. */
export function einstellungsFehler(entwurf: EinstellungsEntwurf): EinstellungsFehler[] {
  const fehler: EinstellungsFehler[] = [];
  const sekunden = entwurf.abfrage_sekunden.trim();
  if (!/^\d+$/.test(sekunden) || Number(sekunden) < 5 || Number(sekunden) > 86400) {
    fehler.push("intervall");
  }
  const e = einstellungenAusEntwurf(entwurf);
  const grenzen = [e.temperatur_min, e.temperatur_max, e.feuchte_min, e.feuchte_max];
  if (grenzen.some((g) => g !== null && !Number.isFinite(g))) {
    fehler.push("zahl");
    return fehler;
  }
  if (e.temperatur_min !== null && e.temperatur_max !== null && e.temperatur_min >= e.temperatur_max) {
    fehler.push("temperatur");
  }
  if (e.feuchte_min !== null && e.feuchte_max !== null && e.feuchte_min >= e.feuchte_max) {
    fehler.push("feuchte");
  }
  return fehler;
}

/**
 * Holt eine Abfrage seitenweise, bis eine Seite nicht mehr voll ist.
 * PostgREST gibt höchstens tausend Zeilen auf einmal — ohne das wäre ein
 * 30-Tage-Verlauf still abgeschnitten.
 */
export async function alleSeiten<T>(
  hole: (von: number, bis: number) => Promise<T[]>,
  groesse = 1000,
): Promise<T[]> {
  const alle: T[] = [];
  for (let von = 0; ; von += groesse) {
    const seite = await hole(von, von + groesse - 1);
    alle.push(...seite);
    if (seite.length < groesse) return alle;
  }
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
    // Ein fester Endpunkt für alle Seiten — sonst verschöbe sich das Fenster
    // zwischen zwei Seiten.
    const bis = new Date().toISOString();
    return alleSeiten(async (von, bisZeile) => {
      const { data, error } = await supabaseBrowser()
        .rpc("sensor_verlauf", { stunden, bis })
        .range(von, bisZeile);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Messung[];
    });
  },

  kennzahlen: async (stunden: number): Promise<Kennzahlen[]> => {
    const { data, error } = await supabaseBrowser().rpc("sensor_kennzahlen", { stunden });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Kennzahlen[];
  },

  einstellungen: async (): Promise<SensorEinstellungen | null> => {
    const { data, error } = await supabaseBrowser()
      .from("sensor_einstellungen")
      .select("abfrage_sekunden,temperatur_min,temperatur_max,feuchte_min,feuchte_max")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const zahl = (w: unknown) => (w === null || w === undefined ? null : Number(w));
    return {
      abfrage_sekunden: Number(data.abfrage_sekunden),
      temperatur_min: zahl(data.temperatur_min),
      temperatur_max: zahl(data.temperatur_max),
      feuchte_min: zahl(data.feuchte_min),
      feuchte_max: zahl(data.feuchte_max),
    };
  },

  einstellungenSpeichern: async (werte: SensorEinstellungen): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("sensor_einstellungen")
      .update({ ...werte, geaendert_am: new Date().toISOString() })
      .eq("id", true)
      .select("abfrage_sekunden");
    // Eine abgewiesene Änderung meldet Postgres als `UPDATE 0`, nicht als Fehler.
    if (error || !data?.length) throw new Error(error?.message ?? "Nicht gespeichert — fehlt das Recht?");
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
