import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Wartung: Maschinen, ihre wiederkehrenden Aufgaben und die Dateien dazu.
 *
 * Alles über PostgREST. Nur der Nachweisbogen kommt aus `compute` — ein
 * Excel-Raster, das LibreOffice nach PDF wandelt.
 */

export const EIMER = "wartung";
export const MAX_DATEI_BYTES = 25 * 1024 * 1024;

export type Intervall =
  | "taeglich"
  | "woechentlich"
  | "monatlich"
  | "quartalsweise"
  | "alle_n_wochen";

/** In der Reihenfolge, in der sie auf dem Bogen stehen. */
export const INTERVALLE: { wert: Intervall; label: string }[] = [
  { wert: "taeglich", label: "Täglich" },
  { wert: "woechentlich", label: "Wöchentlich" },
  { wert: "monatlich", label: "Monatlich" },
  { wert: "quartalsweise", label: "Quartalsweise" },
  { wert: "alle_n_wochen", label: "Alle N Wochen" },
];

export const INTERVALL_LABEL: Record<Intervall, string> = Object.fromEntries(
  INTERVALLE.map((i) => [i.wert, i.label]),
) as Record<Intervall, string>;

/** Wie das Intervall dasteht — mit Zahl, wo eine dazugehört.
 *
 *  Die Namen kommen von außen: sie hängen an der Sprache. `alleN` baut die
 *  Zahl ein, weil „Alle 6 Wochen" und „Every 6 weeks" sie verschieden setzen. */
export function intervallText(
  aufgabe: Pick<Aufgabe, "intervall" | "wochen">,
  namen: Record<string, string> = INTERVALL_LABEL,
  alleN: (wochen: number) => string = (w) => `Alle ${w} Wochen`,
): string {
  if (aufgabe.intervall === "alle_n_wochen" && aufgabe.wochen) {
    return alleN(aufgabe.wochen);
  }
  return namen[aufgabe.intervall] ?? aufgabe.intervall;
}

export type Status = "aktiv" | "stillgelegt";

export interface Maschine {
  id: string;
  name: string;
  inventarnummer: string | null;
  standort: string | null;
  hersteller: string | null;
  modell: string | null;
  verantwortlich: string | null;
  status: Status;
  notizen: string;
  geaendert_am: string;
}

export interface Aufgabe {
  id: string;
  maschine_id: string;
  titel: string;
  anleitung: string;
  intervall: Intervall;
  wochen: number | null;
  erstellt_am: string;
}

export interface Datei {
  id: string;
  maschine_id: string;
  art: "plan" | "nachweis";
  pfad: string;
  dateiname: string;
  mime: string | null;
  hochgeladen_am: string;
}

const MASCHINE_FELDER =
  "id,name,inventarnummer,standort,hersteller,modell,verantwortlich,status," +
  "notizen,geaendert_am";

export const wartungKeys = {
  maschinen: () => ["wartung", "maschinen"] as const,
  maschine: (id: string) => ["wartung", "maschine", id] as const,
  aufgaben: (id: string) => ["wartung", "aufgaben", id] as const,
  dateien: (id: string) => ["wartung", "dateien", id] as const,
};

function sb() {
  return supabaseBrowser();
}

/** Das laufende Halbjahr — die Vorbelegung für den Bogen. */
export function laufendesHalbjahr(heute = new Date()): { jahr: number; halbjahr: 1 | 2 } {
  return {
    jahr: heute.getFullYear(),
    halbjahr: heute.getMonth() > 5 ? 2 : 1,
  };
}

export const wartungApi = {
  maschinen: async (): Promise<Maschine[]> => {
    const { data, error } = await sb()
      .from("maschinen")
      .select(MASCHINE_FELDER)
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Maschine[];
  },

  maschine: async (id: string): Promise<Maschine | null> => {
    const { data, error } = await sb()
      .from("maschinen")
      .select(MASCHINE_FELDER)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Maschine) ?? null;
  },

  anlegen: async (name: string): Promise<Maschine> => {
    const { data, error } = await sb()
      .from("maschinen")
      .insert({ name })
      .select(MASCHINE_FELDER)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as Maschine;
  },

  aendern: async (id: string, felder: Partial<Maschine>): Promise<void> => {
    const { data, error } = await sb()
      .from("maschinen")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    // Eine abgewiesene Änderung meldet Postgres als „0 Zeilen", nicht als
    // Fehler — ohne diese Prüfung stünde „gespeichert", wo nichts steht.
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  loeschen: async (maschine: Maschine, dateien: Datei[]): Promise<void> => {
    // Erst die Bytes, dann die Zeile: die Kaskade räumt die Zeilen, die
    // Dateien muss die Oberfläche selbst nehmen.
    if (dateien.length) {
      await sb().storage.from(EIMER).remove(dateien.map((d) => d.pfad));
    }
    const { error } = await sb().from("maschinen").delete().eq("id", maschine.id);
    if (error) throw new Error(error.message);
  },

  aufgaben: async (maschine_id: string): Promise<Aufgabe[]> => {
    const { data, error } = await sb()
      .from("wartungsaufgaben")
      .select("id,maschine_id,titel,anleitung,intervall,wochen,erstellt_am")
      .eq("maschine_id", maschine_id)
      .order("erstellt_am");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Aufgabe[];
  },

  aufgabeAnlegen: async (
    maschine_id: string,
    titel: string,
    intervall: Intervall,
    wochen: number | null,
  ): Promise<void> => {
    const { error } = await sb().from("wartungsaufgaben").insert({
      maschine_id,
      titel,
      intervall,
      // Die Bedingung an der Tabelle verlangt die Zahl genau dort, wo das
      // Intervall sie braucht — und verbietet sie sonst.
      wochen: intervall === "alle_n_wochen" ? wochen : null,
    });
    if (error) throw new Error(error.message);
  },

  aufgabeAendern: async (id: string, felder: Partial<Aufgabe>): Promise<void> => {
    const { data, error } = await sb()
      .from("wartungsaufgaben")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  aufgabeLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("wartungsaufgaben").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  dateien: async (maschine_id: string): Promise<Datei[]> => {
    const { data, error } = await sb()
      .from("wartungsdateien")
      .select("id,maschine_id,art,pfad,dateiname,mime,hochgeladen_am")
      .eq("maschine_id", maschine_id)
      .order("hochgeladen_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Datei[];
  },

  dateiHochladen: async (
    maschine_id: string,
    art: Datei["art"],
    datei: File,
  ): Promise<void> => {
    if (datei.size > MAX_DATEI_BYTES) throw new Error("Die Datei ist größer als 25 MB.");
    const client = sb();
    const { data: sitzung } = await client.auth.getUser();
    const kennung = sitzung.user?.id;
    if (!kennung) throw new Error("Keine Sitzung.");
    const endung = datei.name.split(".").pop()?.toLowerCase() ?? "bin";
    const pfad = `${kennung}/${crypto.randomUUID()}.${endung}`;
    const { error: speicherFehler } = await client.storage
      .from(EIMER)
      .upload(pfad, datei, { contentType: datei.type || undefined });
    if (speicherFehler) throw new Error(speicherFehler.message);

    const { error } = await client.from("wartungsdateien").insert({
      maschine_id,
      art,
      pfad,
      dateiname: datei.name,
      mime: datei.type || null,
    });
    if (error) {
      // Die Zeile fehlt — dann darf auch die Datei nicht liegen bleiben.
      await client.storage.from(EIMER).remove([pfad]);
      throw new Error(error.message);
    }
  },

  dateiLoeschen: async (datei: Datei): Promise<void> => {
    const client = sb();
    await client.storage.from(EIMER).remove([datei.pfad]);
    const { error } = await client.from("wartungsdateien").delete().eq("id", datei.id);
    if (error) throw new Error(error.message);
  },

  dateiUrl: async (datei: Datei): Promise<string> => {
    const { data, error } = await sb()
      .storage.from(EIMER)
      .createSignedUrl(datei.pfad, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
};
