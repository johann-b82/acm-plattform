import { supabaseBrowser } from "@/lib/supabase/client";
import { computeFetch, computeJson } from "@/lib/compute";

/**
 * Arbeitszeugnisse: Stammdaten, Noten, Text und Dokument.
 *
 * Stammdaten und Noten gehen über PostgREST. Über `compute` läuft nur, was
 * Sprache oder Layout braucht: die Abschnitte bilden (Baukasten oder KI) und
 * das Dokument auf der Briefvorlage setzen.
 */

export const DIMENSIONEN = [
  { wert: "fachwissen", label: "Fachwissen" },
  { wert: "auffassungsgabe", label: "Auffassungsgabe" },
  { wert: "arbeitsweise", label: "Arbeitsweise" },
  { wert: "belastbarkeit", label: "Belastbarkeit" },
  { wert: "arbeitserfolg", label: "Arbeitserfolg" },
  { wert: "sozialverhalten", label: "Sozialverhalten" },
  { wert: "fuehrung", label: "Führung" },
] as const;

export const ARTEN = [
  { wert: "qualifiziert", label: "Qualifiziertes Zeugnis" },
  { wert: "einfach", label: "Einfaches Zeugnis" },
  { wert: "zwischenzeugnis", label: "Zwischenzeugnis" },
  { wert: "ausbildungszeugnis", label: "Ausbildungszeugnis" },
  { wert: "praktikumszeugnis", label: "Praktikumszeugnis" },
] as const;

export const ABSCHNITTE = [
  { wert: "einleitung", label: "Einleitung" },
  { wert: "taetigkeitsbeschreibung", label: "Tätigkeitsbeschreibung" },
  { wert: "leistungsbeurteilung", label: "Leistungsbeurteilung" },
  { wert: "sozialverhalten", label: "Sozialverhalten" },
  { wert: "schlussformel", label: "Schlussformel" },
] as const;

/** Schulnoten. Die Zufriedenheitsformel folgt daraus, nicht umgekehrt. */
export const NOTEN = [
  { wert: 1, label: "1 — sehr gut" },
  { wert: 2, label: "2 — gut" },
  { wert: 3, label: "3 — befriedigend" },
  { wert: 4, label: "4 — ausreichend" },
] as const;

export interface Zeugnis {
  id: string;
  employee_id: number | null;
  extern_id: string | null;
  name: string;
  geschlecht: "m" | "w" | "d" | null;
  geburtsdatum: string | null;
  personalnummer: string | null;
  abteilung: string | null;
  taetigkeit: string | null;
  eintritt: string | null;
  austritt: string | null;
  art: string;
  anlass: string | null;
  fuehrungskraft: boolean;
  ausstellungsdatum: string | null;
  taetigkeit_stichpunkte: string | null;
  besondere_kompetenzen: string | null;
  besondere_erfolge: string | null;
  schlussnote: string | null;
  abschnitte: Record<string, string> | null;
  status: "entwurf" | "fertig";
  erstellt_am: string;
}

export interface Bewertung {
  id: string;
  zeugnis_id: string;
  dimension: string;
  note: number;
}

export interface Baustein {
  id: string;
  dimension: string;
  note: number;
  text: string;
}

export interface Aussteller {
  firma: string;
  standort: string | null;
  unterzeichner1_name: string | null;
  unterzeichner1_titel: string | null;
  unterzeichner2_name: string | null;
  unterzeichner2_titel: string | null;
  hr_employee_id: number | null;
}

const FELDER =
  "id,employee_id,extern_id,name,geschlecht,geburtsdatum,personalnummer," +
  "abteilung,taetigkeit,eintritt,austritt,art,anlass,fuehrungskraft," +
  "ausstellungsdatum,taetigkeit_stichpunkte,besondere_kompetenzen," +
  "besondere_erfolge,schlussnote,abschnitte,status,erstellt_am";

export const zeugnisKeys = {
  liste: () => ["zeugnisse", "liste"] as const,
  eines: (id: string) => ["zeugnisse", id] as const,
  bewertungen: (id: string) => ["zeugnisse", id, "noten"] as const,
  bausteine: () => ["zeugnisse", "bausteine"] as const,
  aussteller: () => ["zeugnisse", "aussteller"] as const,
};

function sb() {
  return supabaseBrowser();
}

/** Die Zufriedenheitsformel zur Durchschnittsnote — zum Nachlesen in der Maske. */
export function zufriedenheit(schnitt: number | null): string | null {
  if (schnitt === null) return null;
  const gerundet = Math.round(schnitt);
  return (
    {
      1: "stets zu unserer vollsten Zufriedenheit",
      2: "stets zu unserer vollen Zufriedenheit",
      3: "zu unserer vollen Zufriedenheit",
      4: "zu unserer Zufriedenheit",
    }[gerundet] ?? null
  );
}

export const zeugnisApi = {
  liste: async (): Promise<Zeugnis[]> => {
    const { data, error } = await sb()
      .from("zeugnisse")
      .select(FELDER)
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Zeugnis[];
  },

  eines: async (id: string): Promise<Zeugnis | null> => {
    const { data, error } = await sb()
      .from("zeugnisse")
      .select(FELDER)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Zeugnis) ?? null;
  },

  anlegen: async (felder: Partial<Zeugnis>): Promise<Zeugnis> => {
    const { data, error } = await sb()
      .from("zeugnisse")
      .insert(felder)
      .select(FELDER)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as Zeugnis;
  },

  aendern: async (id: string, felder: Partial<Zeugnis>): Promise<void> => {
    const { data, error } = await sb()
      .from("zeugnisse")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  loeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("zeugnisse").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  bewertungen: async (zeugnis_id: string): Promise<Bewertung[]> => {
    const { data, error } = await sb()
      .from("zeugnis_bewertungen")
      .select("id,zeugnis_id,dimension,note")
      .eq("zeugnis_id", zeugnis_id);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Bewertung[];
  },

  noteSetzen: async (
    zeugnis_id: string,
    dimension: string,
    note: number | null,
  ): Promise<void> => {
    const client = sb();
    if (note === null) {
      const { error } = await client
        .from("zeugnis_bewertungen")
        .delete()
        .eq("zeugnis_id", zeugnis_id)
        .eq("dimension", dimension);
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await client
      .from("zeugnis_bewertungen")
      .upsert({ zeugnis_id, dimension, note }, { onConflict: "zeugnis_id,dimension" });
    if (error) throw new Error(error.message);
  },

  bausteine: async (): Promise<Baustein[]> => {
    const { data, error } = await sb()
      .from("zeugnis_bausteine")
      .select("id,dimension,note,text")
      .order("dimension")
      .order("note");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Baustein[];
  },

  bausteinSetzen: async (dimension: string, note: number, text: string): Promise<void> => {
    const { error } = await sb()
      .from("zeugnis_bausteine")
      .upsert(
        { dimension, note, text, geaendert_am: new Date().toISOString() },
        { onConflict: "dimension,note" },
      );
    if (error) throw new Error(error.message);
  },

  aussteller: async (): Promise<Aussteller | null> => {
    const { data, error } = await sb()
      .from("zeugnis_aussteller")
      .select(
        "firma,standort,unterzeichner1_name,unterzeichner1_titel," +
          "unterzeichner2_name,unterzeichner2_titel,hr_employee_id",
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Aussteller) ?? null;
  },

  ausstellerAendern: async (felder: Partial<Aussteller>): Promise<void> => {
    const { data, error } = await sb()
      .from("zeugnis_aussteller")
      .update(felder)
      .eq("id", true)
      .select("firma");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  /** Die Abschnitte aus den Textbausteinen bilden — ohne Netz. */
  baukasten: (id: string) =>
    computeJson<{ abschnitte: Record<string, string>; schlussnote: number | null }>(
      `/api/zeugnisse/${id}/baukasten`,
      { method: "POST" },
    ),

  /** Dieselben Abschnitte, von der KI formuliert. */
  ki: (id: string, abschnitt?: string) =>
    computeJson<{ abschnitte: Record<string, string>; schlussnote: number | null }>(
      `/api/zeugnisse/${id}/ki${abschnitt ? `?abschnitt=${abschnitt}` : ""}`,
      { method: "POST" },
    ),

  dokument: async (id: string, art: "docx" | "pdf"): Promise<void> => {
    const antwort = await computeFetch(`/api/zeugnisse/${id}/dokument.${art}`);
    if (!antwort.ok) {
      throw new Error((await antwort.text()).slice(0, 200) || `HTTP ${antwort.status}`);
    }
    const url = URL.createObjectURL(await antwort.blob());
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
