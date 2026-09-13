import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Einarbeitung: Inhalte, Abteilungsmatrix und der persönliche Bogen.
 *
 * Ein Inhalt gehört einem Ansprechpartner, nicht einer Abteilung — welche
 * Abteilung ihn braucht, sagt die Matrix. Dieselbe Trennung wie bei den
 * Schulungen, und aus demselben Grund: sonst stünde derselbe Inhalt
 * mehrfach da.
 */

export interface Inhalt {
  id: string;
  inhalt: string;
  ansprechpartner: string | null;
  bereich: string | null;
  reihenfolge: number;
}

export interface Pflicht {
  id: string;
  einarbeitung_id: string;
  abteilung: string;
}

export const einarbeitungKeys = {
  katalog: () => ["einarbeitung", "katalog"] as const,
  pflicht: () => ["einarbeitung", "pflicht"] as const,
};

function sb() {
  return supabaseBrowser();
}

/**
 * Die Spalten der Abteilungsmatrix: die Abteilungen der aktiven Belegschaft
 * und die, die schon eine Zuordnung tragen — wie im Altsystem. Ohne die
 * zweite Hälfte verschwände eine Zuordnung aus der Ansicht, sobald die letzte
 * Person der Abteilung ausgetreten ist.
 */
export function abteilungsachse(
  personio: readonly (string | null)[],
  gepflegt: readonly string[],
): string[] {
  return [
    ...new Set([...personio, ...gepflegt].map((a) => (a ?? "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "de"));
}

export const einarbeitungApi = {
  katalog: async (): Promise<Inhalt[]> => {
    const { data, error } = await sb()
      .from("einarbeitung_katalog")
      .select("id,inhalt,ansprechpartner,bereich,reihenfolge")
      .order("reihenfolge")
      .order("inhalt");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Inhalt[];
  },

  anlegen: async (inhalt: string, reihenfolge: number): Promise<void> => {
    const { error } = await sb()
      .from("einarbeitung_katalog")
      .insert({ inhalt, reihenfolge });
    if (error) throw new Error(error.message);
  },

  aendern: async (id: string, felder: Partial<Inhalt>): Promise<void> => {
    const { data, error } = await sb()
      .from("einarbeitung_katalog")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  loeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("einarbeitung_katalog").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  /** Die Abteilungen der aktiven Belegschaft, für die Matrixspalten. */
  personioAbteilungen: async (): Promise<(string | null)[]> => {
    const { data, error } = await sb().from("organigramm").select("department");
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as { department: string | null }[]).map((z) => z.department);
  },

  pflicht: async (): Promise<Pflicht[]> => {
    const { data, error } = await sb()
      .from("einarbeitung_pflicht")
      .select("id,einarbeitung_id,abteilung")
      .order("abteilung");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Pflicht[];
  },

  pflichtSetzen: async (
    einarbeitung_id: string,
    abteilung: string,
    an: boolean,
  ): Promise<void> => {
    const client = sb();
    const { error } = an
      ? await client.from("einarbeitung_pflicht").insert({ einarbeitung_id, abteilung })
      : await client
          .from("einarbeitung_pflicht")
          .delete()
          .eq("einarbeitung_id", einarbeitung_id)
          .eq("abteilung", abteilung);
    if (error) throw new Error(error.message);
  },

  /** Der Bogen kommt als PDF von `compute` und braucht das Bearer-Token. */
  bogenUrl: (frage: Record<string, string>): string =>
    `/api/einarbeitung/bogen.pdf?${new URLSearchParams(frage).toString()}`,
};
