import { supabaseBrowser } from "@/lib/supabase/client";
import { computeJson } from "@/lib/compute";

/**
 * ATR: Teilekatalog und Vorlage.
 *
 * Pflegen und Lesen gehen über PostgREST. Nur das Einlesen der Referenzmappe
 * läuft über `compute` — eine Excel-Datei mit festen Zellen und
 * Abschnittsüberschriften ist weder in SQL noch über PostgREST zu lesen.
 */

export const EIMER = "atr";
export const MAX_DATEI_BYTES = 25 * 1024 * 1024;
export const XLSX_TYP =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface Teil {
  id: string;
  teilenummer: string;
  teilenummer_norm: string | null;
  lieferantennummer: string | null;
  bezeichnung: string | null;
  zeichnung: string | null;
  gewicht_kg: string | null;
  menge: number;
  kategorie: string | null;
  bestellposition: string | null;
  herkunft: string | null;
  geaendert_am: string;
}

export interface Vorlage {
  programm: string;
  kunde: string | null;
  arbeitspaket: string | null;
  besteller_spez: string | null;
  atp: string | null;
  lieferanten_spez: string | null;
  referenz: string | null;
  lieferant: string | null;
  kunden_spez: string | null;
  nscm: string | null;
  ata_kapitel: string | null;
  waage: string | null;
  qs_unterschrift: string | null;
  geruest_pfad: string | null;
  geruest_dateiname: string | null;
  geaendert_am: string;
}

export interface ImportErgebnis {
  dateiname: string;
  programm: string | null;
  teile_gelesen: number;
  teile_neu: number;
  teile_aktualisiert: number;
  vorlage_uebernommen: boolean;
  hinweise: string[];
}

export const atrKeys = {
  teile: (suche: string) => ["atr", "teile", suche] as const,
  vorlagen: () => ["atr", "vorlagen"] as const,
};

const TEIL_FELDER =
  "id,teilenummer,teilenummer_norm,lieferantennummer,bezeichnung,zeichnung," +
  "gewicht_kg,menge,kategorie,bestellposition,herkunft,geaendert_am";

const VORLAGE_FELDER =
  "programm,kunde,arbeitspaket,besteller_spez,atp,lieferanten_spez,referenz," +
  "lieferant,kunden_spez,nscm,ata_kapitel,waage,qs_unterschrift," +
  "geruest_pfad,geruest_dateiname,geaendert_am";

function pruefeBetroffen(daten: unknown[] | null): void {
  if (!daten?.length) {
    throw new Error("Nicht gespeichert — fehlt das Recht, ATR zu bearbeiten?");
  }
}

export const atrApi = {
  /** Sucht über Teilenummer und Bezeichnung. Eine Zifferneingabe trifft auch
   *  eine anders geschriebene Nummer, weil die normierte Spalte mitgesucht
   *  wird — genau dafür ist sie da. */
  teile: async (suche: string): Promise<Teil[]> => {
    let anfrage = supabaseBrowser()
      .from("atr_teile")
      .select(TEIL_FELDER)
      .order("teilenummer")
      .limit(500);
    const text = suche.trim();
    if (text) {
      const muster = `%${text}%`;
      const ziffern = text.replace(/\D/g, "");
      const teile = [
        `teilenummer.ilike.${muster}`,
        `bezeichnung.ilike.${muster}`,
        `zeichnung.ilike.${muster}`,
      ];
      if (ziffern) teile.push(`teilenummer_norm.ilike.%${ziffern}%`);
      anfrage = anfrage.or(teile.join(","));
    }
    const { data, error } = await anfrage;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Teil[];
  },

  teilAendern: async (id: string, felder: Partial<Teil>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_teile")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  teilAnlegen: async (teilenummer: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_teile")
      .insert({ teilenummer, herkunft: "von Hand" })
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  teilLoeschen: async (id: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_teile")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  vorlagen: async (): Promise<Vorlage[]> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_vorlagen")
      .select(VORLAGE_FELDER)
      .order("programm");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Vorlage[];
  },

  vorlageAendern: async (
    programm: string,
    felder: Partial<Vorlage>,
  ): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_vorlagen")
      .update(felder)
      .eq("programm", programm)
      .select("programm");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Legt die Gerüstdatei ab und ersetzt eine vorhandene, statt sie liegen
   *  zu lassen. */
  geruestSetzen: async (v: Vorlage, datei: File): Promise<void> => {
    if (datei.size > MAX_DATEI_BYTES) {
      throw new Error("Die Datei ist größer als 25 MB.");
    }
    if (datei.type !== XLSX_TYP) {
      throw new Error("Das Gerüst muss eine .xlsx-Datei sein.");
    }
    const sb = supabaseBrowser();
    const { data: sitzung } = await sb.auth.getUser();
    const kennung = sitzung.user?.id;
    if (!kennung) throw new Error("Keine Sitzung.");
    const pfad = `${kennung}/${crypto.randomUUID()}.xlsx`;
    const { error: speicherFehler } = await sb.storage
      .from(EIMER)
      .upload(pfad, datei, { contentType: datei.type });
    if (speicherFehler) throw new Error(speicherFehler.message);

    await atrApi.vorlageAendern(v.programm, {
      geruest_pfad: pfad,
      geruest_dateiname: datei.name,
    });
    if (v.geruest_pfad) await sb.storage.from(EIMER).remove([v.geruest_pfad]);
  },

  /** Liest eine Referenzmappe ein — der einzige Weg über `compute`. */
  referenzEinlesen: async (datei: File): Promise<ImportErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<ImportErgebnis>("/api/atr/referenz", {
      method: "POST",
      body: rumpf,
    });
  },
};

export type LieferungStatus = "entwurf" | "freigegeben";

export interface Lieferung {
  id: string;
  quelle_dateiname: string;
  lieferschein_nr: string | null;
  datum: string | null;
  ba_auftrag: string | null;
  bestellnummer: string | null;
  programm: string | null;
  programm_grund: string | null;
  bereich: string | null;
  msn: string | null;
  bettvariante: string | null;
  satz_titel: string | null;
  atr_nummer: string | null;
  containernummer: string | null;
  wiegedatum: string | null;
  pruefdatum: string | null;
  qs_unterschrift: string | null;
  max_gewicht_kg: string | null;
  status: LieferungStatus;
  hinweise: string[];
  mappe_pfad: string | null;
  pdf_pfad: string | null;
  etikett_pfad: string | null;
  erzeugt_am: string | null;
  geaendert_am: string;
  erstellt_am: string;
}

export interface AtrPosition {
  id: string;
  lieferung_id: string;
  reihenfolge: number;
  pos: number | null;
  lieferantennummer: string | null;
  teilenummer: string | null;
  teilenummer_norm: string | null;
  teil_id: string | null;
  bezeichnung: string | null;
  zeichnung: string | null;
  kategorie: string | null;
  menge: number;
  gewicht_kg: string | null;
  bestellposition: string | null;
  seriennummern: string[];
}

export interface ErzeugtErgebnis {
  mappe_pfad: string;
  pdf_pfad: string | null;
  etikett_pfad: string;
  pdf_hinweis: string | null;
}

export interface LieferscheinErgebnis {
  lieferung_id: string;
  dateiname: string;
  lieferschein_nr: string | null;
  programm: string | null;
  programm_grund: string;
  positionen: number;
  zugeordnet: number;
  hinweise: string[];
}

const LIEFERUNG_FELDER =
  "id,quelle_dateiname,lieferschein_nr,datum,ba_auftrag,bestellnummer,programm," +
  "programm_grund,bereich,msn,bettvariante,satz_titel,atr_nummer,containernummer," +
  "wiegedatum,pruefdatum,qs_unterschrift,max_gewicht_kg,status,hinweise," +
  "mappe_pfad,pdf_pfad,etikett_pfad,erzeugt_am,geaendert_am,erstellt_am";

const POSITION_FELDER =
  "id,lieferung_id,reihenfolge,pos,lieferantennummer,teilenummer,teilenummer_norm," +
  "teil_id,bezeichnung,zeichnung,kategorie,menge,gewicht_kg,bestellposition,seriennummern";

export const lieferungKeys = {
  liste: () => ["atr", "lieferungen"] as const,
  eine: (id: string) => ["atr", "lieferung", id] as const,
  positionen: (id: string) => ["atr", "positionen", id] as const,
};

export const lieferungApi = {
  liste: async (): Promise<Lieferung[]> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_lieferungen")
      .select(LIEFERUNG_FELDER)
      .order("erstellt_am", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Lieferung[];
  },

  eine: async (id: string): Promise<Lieferung | null> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_lieferungen")
      .select(LIEFERUNG_FELDER)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Lieferung) ?? null;
  },

  positionen: async (id: string): Promise<AtrPosition[]> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_positionen")
      .select(POSITION_FELDER)
      .eq("lieferung_id", id)
      .order("reihenfolge");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AtrPosition[];
  },

  aendern: async (id: string, felder: Partial<Lieferung>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_lieferungen")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  positionAendern: async (
    id: string,
    felder: Partial<AtrPosition>,
  ): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_positionen")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  positionLoeschen: async (id: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_positionen")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  loeschen: async (id: string): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_lieferungen")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Erzeugt Mappe, PDF und Etikett — über `compute`, weil dort openpyxl und
   *  LibreOffice sitzen. */
  erzeugen: async (id: string): Promise<ErzeugtErgebnis> =>
    computeJson<ErzeugtErgebnis>(`/api/atr/lieferungen/${id}/erzeugen`, {
      method: "POST",
    }),

  /** Kurzlebige URL auf eine erzeugte Datei im nicht-öffentlichen Eimer. */
  dateiUrl: async (pfad: string): Promise<string> => {
    const { data, error } = await supabaseBrowser()
      .storage.from(EIMER)
      .createSignedUrl(pfad, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  /** Liest einen Lieferschein ein — über `compute`, weil das PDF geparst wird. */
  einlesen: async (datei: File): Promise<LieferscheinErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<LieferscheinErgebnis>("/api/atr/lieferschein", {
      method: "POST",
      body: rumpf,
    });
  },
};
