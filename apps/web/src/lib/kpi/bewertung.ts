import { rpc } from "@/lib/kpi/gemeinsam";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * KPI-Bewertung & Maßnahmen, aufgebaut wie im Altsystem (MAS-01).
 *
 * **Bubbles** sind nummerierte Marker, die auf einer Dashboard-Seite über
 * einen Bereich gezogen werden, mit einem Satz dazu, was dort auffällt. Sie
 * liegen in `kpi_kommentare` — ein Kommentar aus der Zeit vor den Bubbles ist
 * eine Bubble ohne Position. **Maßnahmen** hängen an einer Kennzahl aus
 * `zielwerte` und optional an einer Bubble ihres Bereichs.
 *
 * Reines Lesen und Schreiben über PostgREST. Lesen darf, wer `kpi` hat,
 * schreiben, wer die Einstellungen bearbeiten darf.
 */

/** `laeuft` heißt auf der Oberfläche „in Arbeit“ — so wie im Altsystem. */
export type MassnahmeStatus = "offen" | "laeuft" | "erledigt" | "verworfen";
export const STATUS_FOLGE: MassnahmeStatus[] = ["offen", "laeuft", "erledigt", "verworfen"];

export type Prioritaet = "niedrig" | "mittel" | "hoch";
export const PRIORITAETEN: Prioritaet[] = ["niedrig", "mittel", "hoch"];

export type Ampel = "rot" | "gelb" | "gruen";

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

export interface Bubble {
  id: string;
  schluessel: string | null;
  bereich: string;
  nummer: number;
  text: string;
  ampel: Ampel | null;
  pos_x: number | null;
  pos_y: number | null;
  breite: number | null;
  hoehe: number | null;
  verfasser_email: string | null;
  gesehen_am: string | null;
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
  prioritaet: Prioritaet;
  kommentar_id: string | null;
  erledigt_am: string | null;
  erstellt_am: string;
  geaendert_am: string;
}

/** Die Dashboard-Seite je Bereich. HR liegt unter `/hr`, nicht unter `/kpi`. */
export const BEREICH_PFAD: Record<string, string> = {
  vertrieb: "/kpi/vertrieb",
  personal: "/hr/kennzahlen",
  qualitaet: "/kpi/qualitaet",
  finanzen: "/kpi/finanzen",
  einkauf: "/kpi/einkauf",
  produktion: "/kpi/produktion",
};

export function bereichFuerPfad(pfad: string): string | null {
  return Object.entries(BEREICH_PFAD).find(([, p]) => p === pfad)?.[0] ?? null;
}

export function prioritaetRang(p: Prioritaet): number {
  return PRIORITAETEN.indexOf(p) + 1;
}

export function filtereMassnahmen(
  liste: readonly Massnahme[],
  status: MassnahmeStatus | "alle",
): Massnahme[] {
  return status === "alle" ? [...liste] : liste.filter((m) => m.status === status);
}

/** Die Bubbles, die eine Maßnahme zur Kennzahl dieses Bereichs zuordnen kann. */
export function bubblesDesBereichs(bubbles: readonly Bubble[], bereich: string | null): Bubble[] {
  if (!bereich) return [];
  return bubbles.filter((b) => b.bereich === bereich).sort((a, b) => a.nummer - b.nummer);
}

export interface Punkt {
  x: number;
  y: number;
}
export interface Rechteck {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Das aufgezogene Rechteck, gleich in welche Richtung gezogen wurde. Unter
 *  einem Hundertstel in einer Richtung war es ein Klick, kein Bereich. */
export function aufgezogen(start: Punkt, ende: Punkt): Rechteck | null {
  const r = {
    x: Math.min(start.x, ende.x),
    y: Math.min(start.y, ende.y),
    w: Math.abs(ende.x - start.x),
    h: Math.abs(ende.y - start.y),
  };
  return r.w < 0.01 || r.h < 0.01 ? null : r;
}

function zahl(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function zahlOderNull(v: unknown): number | null {
  return v == null ? null : Number(v);
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

const BUBBLE_FELDER =
  "id,schluessel,bereich,nummer,text,ampel,pos_x,pos_y,breite,hoehe,verfasser_email,gesehen_am,erstellt_am";
const MASSNAHME_FELDER =
  "id,schluessel,titel,beschreibung,zustaendig,faellig_am,status,prioritaet,kommentar_id," +
  "erledigt_am,erstellt_am,geaendert_am";

export const bewertungKeys = {
  uebersicht: () => ["kpi", "bewertung", "uebersicht"] as const,
  bubbles: () => ["kpi", "bewertung", "bubbles"] as const,
  massnahmen: () => ["kpi", "bewertung", "massnahmen"] as const,
  verantwortliche: () => ["kpi", "bewertung", "verantwortliche"] as const,
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

  /** Alle Bubbles, die neuesten zuerst — wie die Liste im Altsystem. */
  bubbles: async (): Promise<Bubble[]> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_kommentare")
      .select(BUBBLE_FELDER)
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Bubble[]).map((b) => ({
      ...b,
      pos_x: zahlOderNull(b.pos_x),
      pos_y: zahlOderNull(b.pos_y),
      breite: zahlOderNull(b.breite),
      hoehe: zahlOderNull(b.hoehe),
    }));
  },

  /** Nummer und Verfasser setzt die Datenbank. */
  bubbleAnlegen: async (felder: {
    bereich: string;
    text: string;
    ampel: Ampel | null;
    rechteck: Rechteck;
  }): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_kommentare")
      .insert({
        bereich: felder.bereich,
        text: felder.text,
        ampel: felder.ampel,
        pos_x: felder.rechteck.x,
        pos_y: felder.rechteck.y,
        breite: felder.rechteck.w,
        hoehe: felder.rechteck.h,
      })
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  bubbleGesehen: async (id: string): Promise<void> => {
    const { error } = await supabaseBrowser()
      .from("kpi_kommentare")
      .update({ gesehen_am: new Date().toISOString() })
      .eq("id", id)
      .is("gesehen_am", null);
    // Kein `pruefeBetroffen`: war sie schon gesehen, ändert sich nichts.
    if (error) throw new Error(error.message);
  },

  bubbleLoeschen: async (id: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_kommentare")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Alle Maßnahmen über alle Kennzahlen, die neuesten zuerst. Der
   *  Statusfilter wirkt im Browser auf die ganze Menge. */
  massnahmen: async (): Promise<Massnahme[]> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_massnahmen")
      .select(MASSNAHME_FELDER)
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Massnahme[];
  },

  massnahmeAnlegen: async (felder: {
    schluessel: string;
    kommentar_id: string | null;
    titel: string;
    zustaendig: string | null;
    faellig_am: string | null;
    prioritaet: Prioritaet;
  }): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_massnahmen")
      .insert(felder)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Ändert einzelne Felder. `erledigt_am` setzt die Datenbank selbst. */
  massnahmeAendern: async (
    id: string,
    felder: Partial<Pick<Massnahme, "zustaendig" | "faellig_am" | "prioritaet" | "status">>,
  ): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("kpi_massnahmen")
      .update(felder)
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

  /** Aktive Personen aus Personio als „Nachname, Vorname“. */
  verantwortliche: async (): Promise<string[]> => {
    const rows = await rpc<{ name: string }[]>("kpi_verantwortliche", {});
    return rows.map((r) => r.name);
  },
};
