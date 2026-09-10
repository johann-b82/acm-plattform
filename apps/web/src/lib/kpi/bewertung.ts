import { rpc } from "@/lib/kpi/gemeinsam";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * KPI-Bewertung: Kommentare und Maßnahmen zu jeder Kennzahl.
 *
 * Reines Lesen und Schreiben über PostgREST — `compute` kommt hier nicht vor.
 * Nur die Übersicht ist eine SQL-Funktion, weil sie über zwei Tabellen je
 * Kennzahl zusammenzählt; als gespeicherte Spalte wäre das nicht zu haben.
 *
 * Die Registry ist `zielwerte`: wer eine Kennzahl mit Zielwert anlegt, kann
 * sie damit auch bewerten. Eine zweite Liste, die auseinanderlaufen kann,
 * gibt es nicht.
 */

export type MassnahmeStatus = "offen" | "laeuft" | "erledigt" | "verworfen";

export const STATUS_LABEL: Record<MassnahmeStatus, string> = {
  offen: "offen",
  laeuft: "läuft",
  erledigt: "erledigt",
  verworfen: "verworfen",
};

export interface Uebersichtszeile {
  schluessel: string;
  bereich: string;
  label: string;
  kommentare: number;
  letzter_kommentar: string | null;
  offen: number;
  ueberfaellig: number;
  erledigt: number;
}

export interface Kommentar {
  id: string;
  schluessel: string;
  zeitraum_von: string | null;
  zeitraum_bis: string | null;
  text: string;
  erstellt_am: string;
}

export interface Massnahme {
  id: string;
  schluessel: string;
  titel: string;
  beschreibung: string | null;
  zustaendig: string | null;
  faellig_am: string | null;
  status: MassnahmeStatus;
  erledigt_am: string | null;
  geaendert_am: string;
}

function zahl(v: unknown): number {
  return v == null ? 0 : Number(v);
}

/** Wirft, wenn die Policy die Änderung abgewiesen hat.
 *
 *  Ohne diese Prüfung meldet PostgREST eine von RLS verweigerte Änderung als
 *  Erfolg — Postgres sagt `UPDATE 0`, keinen Fehler. Siehe `setzeZielwert`. */
function pruefeBetroffen(daten: unknown[] | null): void {
  if (!daten?.length) {
    throw new Error("Nicht gespeichert — fehlt das Recht, Einstellungen zu bearbeiten?");
  }
}

export const bewertungKeys = {
  uebersicht: () => ["kpi", "bewertung", "uebersicht"] as const,
  kommentare: (schluessel: string) => ["kpi", "bewertung", "kommentare", schluessel] as const,
  massnahmen: (schluessel: string) => ["kpi", "bewertung", "massnahmen", schluessel] as const,
};

export const bewertungApi = {
  uebersicht: async (): Promise<Uebersichtszeile[]> => {
    const rows = await rpc<Uebersichtszeile[]>("kpi_bewertung_uebersicht", {});
    return rows.map((r) => ({
      ...r,
      kommentare: zahl(r.kommentare),
      offen: zahl(r.offen),
      ueberfaellig: zahl(r.ueberfaellig),
      erledigt: zahl(r.erledigt),
    }));
  },

  kommentare: async (schluessel: string): Promise<Kommentar[]> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_kommentare")
      .select("id,schluessel,zeitraum_von,zeitraum_bis,text,erstellt_am")
      .eq("schluessel", schluessel)
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Kommentar[];
  },

  kommentarAnlegen: async (schluessel: string, text: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_kommentare")
      .insert({ schluessel, text })
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  kommentarLoeschen: async (id: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_kommentare")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  massnahmen: async (schluessel: string): Promise<Massnahme[]> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_massnahmen")
      .select("id,schluessel,titel,beschreibung,zustaendig,faellig_am,status,erledigt_am,geaendert_am")
      .eq("schluessel", schluessel)
      .order("status")
      .order("faellig_am", { nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Massnahme[];
  },

  massnahmeAnlegen: async (
    schluessel: string,
    felder: { titel: string; zustaendig?: string; faellig_am?: string | null },
  ): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_massnahmen")
      .insert({
        schluessel,
        titel: felder.titel,
        zustaendig: felder.zustaendig || null,
        faellig_am: felder.faellig_am || null,
      })
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Status ändern. `erledigt_am` setzt die Datenbank selbst. */
  massnahmeStatus: async (id: string, status: MassnahmeStatus): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_massnahmen")
      .update({ status })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  massnahmeLoeschen: async (id: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_massnahmen")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },
};
