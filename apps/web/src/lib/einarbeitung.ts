import { supabaseBrowser } from "@/lib/supabase/client";
import { achse, positionNorm, type Geltung, type PflichtBasis } from "@/lib/pflicht";

/**
 * Einarbeitung: Inhalte, Anforderungsmatrix und der persönliche Bogen.
 *
 * Ein Inhalt gehört einem Ansprechpartner, nicht einer Abteilung — für wen er
 * Pflicht ist, sagt die Matrix. Wie bei den Schulungen gilt eine Pflicht für
 * alle, eine Abteilung, eine Position oder die Kombination beider; dieselbe
 * Trennung und aus demselben Grund: sonst stünde derselbe Inhalt mehrfach da.
 */

export interface Inhalt {
  id: string;
  inhalt: string;
  ansprechpartner: string | null;
  bereich: string | null;
  reihenfolge: number;
}

export interface Pflicht extends PflichtBasis {
  einarbeitung_id: string;
}

export const einarbeitungKeys = {
  katalog: () => ["einarbeitung", "katalog"] as const,
  pflicht: () => ["einarbeitung", "pflicht"] as const,
};

function sb() {
  return supabaseBrowser();
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

  /**
   * Die Werte einer Achse (Abteilungen oder Positionen): die der aktiven
   * Belegschaft aus dem Organigramm plus die, die schon eine Pflicht tragen —
   * sonst verschwände eine Zuordnung, sobald niemand mehr darin steht.
   */
  pflichtAchse: async (
    feld: "abteilung" | "position",
    pflichten: readonly Pflicht[],
  ): Promise<string[]> => {
    const spalte = feld === "abteilung" ? "department" : "position";
    const { data, error } = await sb().from("organigramm").select(spalte);
    if (error) throw new Error(error.message);
    const quelle = ((data ?? []) as unknown as Record<string, string | null>[]).map((z) => z[spalte]);
    return achse(quelle, pflichten.map((p) => p[feld]));
  },

  pflicht: async (): Promise<Pflicht[]> => {
    const { data, error } = await sb()
      .from("einarbeitung_pflicht")
      .select("id,einarbeitung_id,geltung,abteilung,position,position_norm")
      .order("geltung");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Pflicht[];
  },

  /**
   * Eine Pflicht setzen oder wegnehmen. Welche Felder gefüllt sind, hängt an
   * der Geltung — `position_norm` rechnet der Datenbank-Trigger, hier wird nur
   * zum Löschen normiert verglichen.
   */
  pflichtSetzen: async (
    einarbeitung_id: string,
    geltung: Geltung,
    ziel: { abteilung?: string | null; position?: string | null },
    an: boolean,
  ): Promise<void> => {
    const client = sb();
    const abteilung = geltung === "abteilung" || geltung === "abteilung_position" ? ziel.abteilung ?? null : null;
    const position = geltung === "position" || geltung === "abteilung_position" ? ziel.position ?? null : null;
    if (an) {
      const { error } = await client
        .from("einarbeitung_pflicht")
        .insert({ einarbeitung_id, geltung, abteilung, position });
      if (error) throw new Error(error.message);
      return;
    }
    let frage = client
      .from("einarbeitung_pflicht")
      .delete()
      .eq("einarbeitung_id", einarbeitung_id)
      .eq("geltung", geltung);
    frage = abteilung === null ? frage.is("abteilung", null) : frage.eq("abteilung", abteilung);
    frage = position === null ? frage.is("position_norm", null) : frage.eq("position_norm", positionNorm(position));
    const { error } = await frage;
    if (error) throw new Error(error.message);
  },

  /** Der Bogen kommt als PDF von `compute` und braucht das Bearer-Token. */
  bogenUrl: (frage: Record<string, string>): string =>
    `/api/einarbeitung/bogen.pdf?${new URLSearchParams(frage).toString()}`,
};
