import { supabaseBrowser } from "@/lib/supabase/client";
import { computeJson } from "@/lib/compute";

/**
 * Schulungen: Katalog, Anforderungsmatrix, Teilnahmen.
 *
 * Gelesen und gepflegt über PostgREST. Nur das Einlesen der
 * Schulungsübersicht läuft über `compute` — eine transponierte Excel mit drei
 * Zeilen je Schulung und Namensabgleich gegen ein Personio-Freifeld.
 *
 * Die Fälligkeit steht nirgends gespeichert: die Sicht `schulung_stand`
 * rechnet sie aus letztem Termin und Turnus. Ändert jemand den Turnus, stimmt
 * sie sofort — im Altprojekt bliebe die gespeicherte Spalte stehen.
 */

export interface Schulung {
  id: string;
  bereich: string;
  name: string;
  turnus: string | null;
  turnus_monate: number | null;
  frist_tage: number | null;
  verantwortlicher: string | null;
  beschreibung: string | null;
  sortierung: number;
  aktiv: boolean;
}

export interface Pflicht {
  id: string;
  schulung_id: string;
  ebene: "kuerzel" | "personio";
  abteilung: string;
}

export interface Teilnahme {
  id: string;
  schulung_id: string;
  employee_id: number | null;
  extern_id: string | null;
  personalnummer: string | null;
  mitarbeiter_name: string | null;
  abteilung_kuerzel: string | null;
  initial_datum: string | null;
  aktuell_datum: string | null;
  naechste_faellig: string | null;
}

export interface Stand {
  teilnahme_id: string;
  schulung_id: string;
  employee_id: number | null;
  bereich: string;
  schulung: string;
  turnus_monate: number | null;
  aktuell_datum: string | null;
  faellig_am: string | null;
  ueberfaellig: boolean;
  nie_absolviert: boolean;
}

export interface OhneZuordnung {
  personalnummer: string;
  mitarbeiter_name: string | null;
  teilnahmen: number;
}

export interface ImportErgebnis {
  dateiname: string;
  schulungen: number;
  schulungen_neu: number;
  teilnahmen: number;
  teilnahmen_zugeordnet: number;
  bereiche: Record<string, number>;
  nicht_zugeordnet: OhneZuordnung[];
  hinweise: string[];
}

const SCHULUNG_FELDER =
  "id,bereich,name,turnus,turnus_monate,frist_tage,verantwortlicher," +
  "beschreibung,sortierung,aktiv";

export const schulungKeys = {
  katalog: () => ["schulungen", "katalog"] as const,
  pflicht: () => ["schulungen", "pflicht"] as const,
  teilnahmen: (id: string) => ["schulungen", "teilnahmen", id] as const,
  stand: () => ["schulungen", "stand"] as const,
};

function sb() {
  return supabaseBrowser();
}

/**
 * Wie dringend ist es? Nie absolviert wiegt schwerer als überfällig: das eine
 * ist eine Lücke, das andere eine Verspätung.
 */
export type Dringlichkeit = "offen" | "ueberfaellig" | "nie" | "faellig_bald";

export function dringlichkeit(stand: Stand, heute = new Date()): Dringlichkeit {
  if (stand.nie_absolviert) return "nie";
  if (stand.ueberfaellig) return "ueberfaellig";
  if (stand.faellig_am) {
    const tage = (new Date(stand.faellig_am).getTime() - heute.getTime()) / 86_400_000;
    if (tage <= 60) return "faellig_bald";
  }
  return "offen";
}

export const DRINGLICHKEIT_LABEL: Record<Dringlichkeit, string> = {
  nie: "nie absolviert",
  ueberfaellig: "überfällig",
  faellig_bald: "wird fällig",
  offen: "im Turnus",
};

export const schulungApi = {
  katalog: async (): Promise<Schulung[]> => {
    const { data, error } = await sb()
      .from("schulung_katalog")
      .select(SCHULUNG_FELDER)
      .order("bereich")
      .order("sortierung");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Schulung[];
  },

  anlegen: async (bereich: string, name: string): Promise<void> => {
    const { error } = await sb().from("schulung_katalog").insert({ bereich, name });
    if (error) throw new Error(error.message);
  },

  aendern: async (id: string, felder: Partial<Schulung>): Promise<void> => {
    const { data, error } = await sb()
      .from("schulung_katalog")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  loeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("schulung_katalog").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  pflicht: async (): Promise<Pflicht[]> => {
    const { data, error } = await sb()
      .from("schulung_pflicht")
      .select("id,schulung_id,ebene,abteilung")
      .order("abteilung");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Pflicht[];
  },

  pflichtSetzen: async (
    schulung_id: string,
    ebene: Pflicht["ebene"],
    abteilung: string,
    an: boolean,
  ): Promise<void> => {
    const client = sb();
    const { error } = an
      ? await client.from("schulung_pflicht").insert({ schulung_id, ebene, abteilung })
      : await client
          .from("schulung_pflicht")
          .delete()
          .eq("schulung_id", schulung_id)
          .eq("ebene", ebene)
          .eq("abteilung", abteilung);
    if (error) throw new Error(error.message);
  },

  teilnahmen: async (schulung_id: string): Promise<Teilnahme[]> => {
    const { data, error } = await sb()
      .from("schulung_teilnahmen")
      .select(
        "id,schulung_id,employee_id,extern_id,personalnummer,mitarbeiter_name," +
          "abteilung_kuerzel,initial_datum,aktuell_datum,naechste_faellig",
      )
      .eq("schulung_id", schulung_id)
      .order("mitarbeiter_name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Teilnahme[];
  },

  teilnahmeAendern: async (id: string, felder: Partial<Teilnahme>): Promise<void> => {
    const { data, error } = await sb()
      .from("schulung_teilnahmen")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  teilnahmeAnlegen: async (
    schulung_id: string,
    mitarbeiter_name: string,
    employee_id: number | null,
  ): Promise<void> => {
    const { error } = await sb()
      .from("schulung_teilnahmen")
      .insert({ schulung_id, mitarbeiter_name, employee_id });
    if (error) throw new Error(error.message);
  },

  teilnahmeLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("schulung_teilnahmen").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  stand: async (): Promise<Stand[]> => {
    const { data, error } = await sb().from("schulung_stand").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Stand[];
  },

  vorschau: async (datei: File): Promise<ImportErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<ImportErgebnis>("/api/schulungen/vorschau", {
      method: "POST",
      body: rumpf,
    });
  },

  uebernehmen: async (datei: File): Promise<ImportErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<ImportErgebnis>("/api/schulungen/uebernehmen", {
      method: "POST",
      body: rumpf,
    });
  },
};
