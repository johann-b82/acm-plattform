import { supabaseBrowser } from "@/lib/supabase/client";
import { computeJson } from "@/lib/compute";

/**
 * Kompetenzen: die Qualifikationsmatrix je Bereich.
 *
 * Zeilen sind Qualifikationen, Spalten sind Personen, eine Zelle sagt: was ist
 * gefordert (Anforderungslevel 0–4) und wie weit ist es erfüllt (0–100 %).
 *
 * Gelesen und gepflegt wird über PostgREST. Nur das Einlesen einer
 * Bereichsdatei läuft über `compute` — eine transponierte Excel mit wandernder
 * Kopfzeile und Namensabgleich gegen Personio.
 */

export const BEREICHE = [
  { wert: "produktion", label: "Produktion" },
  { wert: "verwaltung", label: "Verwaltung" },
  { wert: "safety", label: "Safety" },
  { wert: "quality", label: "Quality" },
] as const;

export type Bereich = (typeof BEREICHE)[number]["wert"];

export const BEREICH_LABEL = Object.fromEntries(
  BEREICHE.map((b) => [b.wert, b.label]),
) as Record<string, string>;

/**
 * Die Bedeutung der Anforderungsstufen. Sie stand im Altprojekt als Legende
 * in der Oberfläche; hier steht sie an einer Stelle im Code.
 */
export const LEVEL_TEXT: Record<number, string> = {
  0: "nicht erforderlich",
  1: "Grundkenntnisse",
  2: "kann unter Anleitung arbeiten",
  3: "arbeitet selbstständig",
  4: "kann anleiten und schulen",
};

export interface Matrix {
  id: string;
  bereich: Bereich;
  blatt: string;
  titel: string | null;
  stand: string | null;
  dateiname: string;
  importiert_am: string;
}

export interface Qualifikation {
  id: string;
  matrix_id: string;
  nr: number | null;
  kategorie: string | null;
  bezeichnung: string;
  reihenfolge: number;
}

export interface MatrixPerson {
  id: string;
  matrix_id: string;
  name: string;
  employee_id: number | null;
  reihenfolge: number;
}

export interface Bewertung {
  id: string;
  qualifikation_id: string;
  person_id: string;
  anforderungslevel: number | null;
  erfuellungsgrad: number | null;
}

export interface Stand {
  qualifikation_id: string;
  matrix_id: string;
  bewertet: number;
  schnitt: number | null;
  luecken: number;
}

export interface MatrixVorschau {
  blatt: string;
  titel: string | null;
  qualifikationen: number;
  personen: number;
  bewertungen: number;
  zugeordnet: number;
  nicht_zugeordnet: string[];
  platzhalter: number;
}

export interface ImportErgebnis {
  dateiname: string;
  bereich: string;
  matrizen: MatrixVorschau[];
  hinweise: string[];
}

export const kompetenzKeys = {
  matrizen: () => ["kompetenzen", "matrizen"] as const,
  qualifikationen: (id: string) => ["kompetenzen", "qualifikationen", id] as const,
  personen: (id: string) => ["kompetenzen", "personen", id] as const,
  bewertungen: (id: string) => ["kompetenzen", "bewertungen", id] as const,
  stand: (id: string) => ["kompetenzen", "stand", id] as const,
};

function sb() {
  return supabaseBrowser();
}

/** Der Schlüssel einer Zelle — Qualifikation und Person zusammen. */
export function zellenschluessel(qualifikation_id: string, person_id: string): string {
  return `${qualifikation_id}|${person_id}`;
}

/**
 * Fehlt hier etwas? Eine Lücke ist eine Zelle mit Anforderung, deren
 * Erfüllungsgrad darunter bleibt. Ohne Anforderung gibt es nichts zu erfüllen.
 */
export function istLuecke(zelle: Bewertung | undefined): boolean {
  if (!zelle || zelle.anforderungslevel === null) return false;
  return (zelle.erfuellungsgrad ?? 0) < 100;
}

export const kompetenzApi = {
  matrizen: async (): Promise<Matrix[]> => {
    const { data, error } = await sb()
      .from("kompetenz_matrizen")
      .select("id,bereich,blatt,titel,stand,dateiname,importiert_am")
      .order("bereich")
      .order("blatt");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Matrix[];
  },

  qualifikationen: async (matrix_id: string): Promise<Qualifikation[]> => {
    const { data, error } = await sb()
      .from("kompetenz_qualifikationen")
      .select("id,matrix_id,nr,kategorie,bezeichnung,reihenfolge")
      .eq("matrix_id", matrix_id)
      .order("reihenfolge");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Qualifikation[];
  },

  personen: async (matrix_id: string): Promise<MatrixPerson[]> => {
    const { data, error } = await sb()
      .from("kompetenz_personen")
      .select("id,matrix_id,name,employee_id,reihenfolge")
      .eq("matrix_id", matrix_id)
      .order("reihenfolge");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as MatrixPerson[];
  },

  bewertungen: async (matrix_id: string): Promise<Bewertung[]> => {
    // Über die Qualifikationen der Matrix gefiltert — die Bewertung selbst
    // kennt die Matrix nicht.
    const { data: qualifikationen, error: qFehler } = await sb()
      .from("kompetenz_qualifikationen")
      .select("id")
      .eq("matrix_id", matrix_id);
    if (qFehler) throw new Error(qFehler.message);
    const ids = ((qualifikationen ?? []) as unknown as { id: string }[]).map(
      (q) => q.id,
    );
    if (ids.length === 0) return [];
    const { data, error } = await sb()
      .from("kompetenz_bewertungen")
      .select("id,qualifikation_id,person_id,anforderungslevel,erfuellungsgrad")
      .in("qualifikation_id", ids);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Bewertung[];
  },

  stand: async (matrix_id: string): Promise<Stand[]> => {
    const { data, error } = await sb()
      .from("kompetenz_stand")
      .select("*")
      .eq("matrix_id", matrix_id);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Stand[];
  },

  /**
   * Eine Zelle setzen. Beide Werte leer heißt: die Zelle verschwindet — die
   * Datenbank lässt eine leere Zelle gar nicht erst zu.
   */
  zelleSetzen: async (
    qualifikation_id: string,
    person_id: string,
    anforderungslevel: number | null,
    erfuellungsgrad: number | null,
  ): Promise<void> => {
    const client = sb();
    if (anforderungslevel === null && erfuellungsgrad === null) {
      const { error } = await client
        .from("kompetenz_bewertungen")
        .delete()
        .eq("qualifikation_id", qualifikation_id)
        .eq("person_id", person_id);
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await client
      .from("kompetenz_bewertungen")
      .upsert(
        {
          qualifikation_id,
          person_id,
          anforderungslevel,
          erfuellungsgrad,
          geaendert_am: new Date().toISOString(),
        },
        { onConflict: "qualifikation_id,person_id" },
      );
    if (error) throw new Error(error.message);
  },

  qualifikationAnlegen: async (
    matrix_id: string,
    bezeichnung: string,
    kategorie: string | null,
    reihenfolge: number,
  ): Promise<void> => {
    const { error } = await sb()
      .from("kompetenz_qualifikationen")
      .insert({ matrix_id, bezeichnung, kategorie, reihenfolge });
    if (error) throw new Error(error.message);
  },

  qualifikationLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("kompetenz_qualifikationen").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  personAnlegen: async (
    matrix_id: string,
    name: string,
    employee_id: number | null,
    reihenfolge: number,
  ): Promise<void> => {
    const { error } = await sb()
      .from("kompetenz_personen")
      .insert({ matrix_id, name, employee_id, reihenfolge });
    if (error) throw new Error(error.message);
  },

  personLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("kompetenz_personen").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  matrixLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("kompetenz_matrizen").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  /** Zeigen, was der Import täte. */
  vorschau: async (bereich: Bereich, datei: File): Promise<ImportErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<ImportErgebnis>(`/api/kompetenzen/${bereich}/vorschau`, {
      method: "POST",
      body: rumpf,
    });
  },

  uebernehmen: async (bereich: Bereich, datei: File): Promise<ImportErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<ImportErgebnis>(`/api/kompetenzen/${bereich}/uebernehmen`, {
      method: "POST",
      body: rumpf,
    });
  },
};
