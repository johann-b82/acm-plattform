import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * FAIR: Zeichnung mit nummerierten Ballons (Erstmusterprüfung).
 *
 * Reines Lesen und Schreiben über PostgREST, die Zeichnung über Supabase
 * Storage. `compute` kommt nicht vor — auch die Nummerierung nicht: die
 * gehört der Datenbank (Migration 0021), damit es keinen Weg gibt, auf dem
 * Lücken oder Doppelnummern entstehen.
 */

export const EIMER = "fair";
export const MAX_DATEI_BYTES = 50 * 1024 * 1024;
export const ERLAUBTE_TYPEN = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export type ZeichnungsArt = "pdf" | "bild";
export type Drehung = 0 | 90 | 180 | 270;

export interface Zeichnung {
  id: string;
  name: string;
  teilenummer: string | null;
  kunde: string | null;
  artikelnummer: string | null;
  pfad: string;
  art: ZeichnungsArt;
  mime: string | null;
  seiten: number;
  drehung: Drehung;
  erstellt_am: string;
}

export interface Ballon {
  id: string;
  zeichnung_id: string;
  nummer: number;
  seite: number;
  bereich_x: number;
  bereich_y: number;
  bereich_b: number;
  bereich_h: number;
  blase_x: number;
  blase_y: number;
  wert: string;
}

export const fairKeys = {
  zeichnungen: () => ["fair", "zeichnungen"] as const,
  zeichnung: (id: string) => ["fair", "zeichnung", id] as const,
  ballons: (id: string) => ["fair", "ballons", id] as const,
  datei: (pfad: string) => ["fair", "datei", pfad] as const,
};

const ZEICHNUNG_FELDER =
  "id,name,teilenummer,kunde,artikelnummer,pfad,art,mime,seiten,drehung,erstellt_am";
const BALLON_FELDER =
  "id,zeichnung_id,nummer,seite,bereich_x,bereich_y,bereich_b,bereich_h," +
  "blase_x,blase_y,wert";

function pruefeBetroffen(daten: unknown[] | null): void {
  if (!daten?.length) {
    throw new Error("Nicht gespeichert — fehlt das Recht, FAIR zu bearbeiten?");
  }
}

/** PostgREST liefert `numeric` als Zeichenkette; hier soll gerechnet werden. */
function zahlen(b: Record<string, unknown>): Ballon {
  const z = (k: string) => Number(b[k]);
  return {
    ...(b as unknown as Ballon),
    nummer: z("nummer"),
    seite: z("seite"),
    bereich_x: z("bereich_x"),
    bereich_y: z("bereich_y"),
    bereich_b: z("bereich_b"),
    bereich_h: z("bereich_h"),
    blase_x: z("blase_x"),
    blase_y: z("blase_y"),
  };
}

export const fairApi = {
  zeichnungen: async (): Promise<Zeichnung[]> => {
    const { data, error } = await supabaseBrowser()
      .from("fair_zeichnungen")
      .select(ZEICHNUNG_FELDER)
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Zeichnung[];
  },

  zeichnung: async (id: string): Promise<Zeichnung | null> => {
    const { data, error } = await supabaseBrowser()
      .from("fair_zeichnungen")
      .select(ZEICHNUNG_FELDER)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Zeichnung) ?? null;
  },

  ballons: async (zeichnungId: string): Promise<Ballon[]> => {
    const { data, error } = await supabaseBrowser()
      .from("fair_ballons")
      .select(BALLON_FELDER)
      .eq("zeichnung_id", zeichnungId)
      .order("nummer");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(zahlen);
  },

  /** Kurzlebige URL auf die Zeichnung im nicht-öffentlichen Eimer. */
  dateiUrl: async (pfad: string): Promise<string> => {
    const { data, error } = await supabaseBrowser()
      .storage.from(EIMER)
      .createSignedUrl(pfad, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  hochladen: async (datei: File, name: string): Promise<Zeichnung> => {
    if (datei.size > MAX_DATEI_BYTES) {
      throw new Error("Die Datei ist größer als 50 MB.");
    }
    if (!ERLAUBTE_TYPEN.includes(datei.type)) {
      throw new Error(`Dateiformat nicht erlaubt: ${datei.type || "unbekannt"}`);
    }
    const sb = supabaseBrowser();
    const { data: sitzung } = await sb.auth.getUser();
    const kennung = sitzung.user?.id;
    if (!kennung) throw new Error("Keine Sitzung.");

    const endung = datei.name.split(".").pop()?.toLowerCase() || "bin";
    const pfad = `${kennung}/${crypto.randomUUID()}.${endung}`;
    const { error: speicherFehler } = await sb.storage
      .from(EIMER)
      .upload(pfad, datei, { contentType: datei.type });
    if (speicherFehler) throw new Error(speicherFehler.message);

    const { data, error } = await sb
      .from("fair_zeichnungen")
      .insert({
        name: name.trim() || datei.name,
        pfad,
        art: datei.type === "application/pdf" ? "pdf" : "bild",
        mime: datei.type,
      })
      .select(ZEICHNUNG_FELDER);
    if (error) {
      // Die Zeile kam nicht zustande — die Datei sonst als Waise zurücklassen.
      await sb.storage.from(EIMER).remove([pfad]);
      throw new Error(error.message);
    }
    pruefeBetroffen(data);
    return data![0] as unknown as Zeichnung;
  },

  zeichnungAendern: async (id: string, felder: Partial<Zeichnung>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("fair_zeichnungen")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Datei vor Zeile: bleibt die Zeile stehen, ist nichts verloren. */
  zeichnungLoeschen: async (z: Zeichnung): Promise<void> => {
    const sb = supabaseBrowser();
    const { error: speicherFehler } = await sb.storage.from(EIMER).remove([z.pfad]);
    if (speicherFehler) throw new Error(speicherFehler.message);
    const { data, error } = await sb
      .from("fair_zeichnungen")
      .delete()
      .eq("id", z.id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Die Nummer vergibt die Datenbank; sie steht deshalb nicht im Aufruf. */
  ballonSetzen: async (
    zeichnungId: string,
    b: {
      seite: number;
      bereich_x: number;
      bereich_y: number;
      bereich_b: number;
      bereich_h: number;
      blase_x: number;
      blase_y: number;
    },
  ): Promise<Ballon> => {
    const { data, error } = await supabaseBrowser()
      .from("fair_ballons")
      .insert({ zeichnung_id: zeichnungId, ...b })
      .select(BALLON_FELDER);
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
    return zahlen(data![0] as Record<string, unknown>);
  },

  ballonAendern: async (id: string, felder: Partial<Ballon>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("fair_ballons")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Löschen genügt — die Lücke schließt ein Trigger. */
  ballonLoeschen: async (id: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("fair_ballons")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Setzt die Nummernfolge auf die Reihenfolge der Kennungen. Die Liste muss
   *  alle Ballons der Zeichnung enthalten — sonst ändert die Funktion nichts. */
  reihenfolge: async (zeichnungId: string, ids: string[]): Promise<void> => {
    const { error } = await supabaseBrowser().rpc("fair_reihenfolge", {
      p_zeichnung: zeichnungId,
      p_ids: ids,
    });
    if (error) throw new Error(error.message);
  },
};
