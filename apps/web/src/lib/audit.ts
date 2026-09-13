import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Audit: Planung, Phasen-Checkliste, Normbezug und Verlauf.
 *
 * Alles über PostgREST — es gibt hier nichts zu rechnen, was nicht die
 * Datenbank besser könnte. Die Phasen entstehen beim Anlegen aus der Vorlage
 * (Trigger), der Verlauf schreibt sich selbst (Trigger), und „überfällig"
 * rechnet die Sicht `audit_stand` beim Lesen aus.
 */

export type AuditStatus =
  | "geplant"
  | "in_vorbereitung"
  | "in_durchfuehrung"
  | "berichtet"
  | "massnahmen_offen"
  | "abgeschlossen"
  | "verschoben"
  | "abgesagt";

export type PhasenStatus = "offen" | "in_arbeit" | "erledigt" | "nicht_zutreffend";
export type Kategorie = "system" | "prozess" | "produkt" | "lieferant";

export const AUDIT_STATUS: { wert: AuditStatus; label: string }[] = [
  { wert: "geplant", label: "Geplant" },
  { wert: "in_vorbereitung", label: "In Vorbereitung" },
  { wert: "in_durchfuehrung", label: "In Durchführung" },
  { wert: "berichtet", label: "Berichtet" },
  { wert: "massnahmen_offen", label: "Maßnahmen offen" },
  { wert: "abgeschlossen", label: "Abgeschlossen" },
  { wert: "verschoben", label: "Verschoben" },
  { wert: "abgesagt", label: "Abgesagt" },
];

export const PHASEN_STATUS: { wert: PhasenStatus; label: string }[] = [
  { wert: "offen", label: "Offen" },
  { wert: "in_arbeit", label: "In Arbeit" },
  { wert: "erledigt", label: "Erledigt" },
  { wert: "nicht_zutreffend", label: "Nicht zutreffend" },
];

export const KATEGORIEN: { wert: Kategorie; label: string }[] = [
  { wert: "system", label: "System" },
  { wert: "prozess", label: "Prozess" },
  { wert: "produkt", label: "Produkt" },
  { wert: "lieferant", label: "Lieferant" },
];

const LABEL = (liste: { wert: string; label: string }[]) =>
  Object.fromEntries(liste.map((e) => [e.wert, e.label])) as Record<string, string>;

export const AUDIT_STATUS_LABEL = LABEL(AUDIT_STATUS);
export const PHASEN_STATUS_LABEL = LABEL(PHASEN_STATUS);
export const KATEGORIE_LABEL = LABEL(KATEGORIEN);

export const PRIORITAET_LABEL: Record<number, string> = {
  1: "niedrig",
  2: "mittel",
  3: "hoch",
};

export interface Audit {
  id: string;
  nummer: string;
  titel: string;
  art: "intern" | "extern";
  bereich: string;
  ziel: string;
  leitender_auditor: string | null;
  team: string;
  geplant_von: string | null;
  geplant_bis: string | null;
  prioritaet: number;
  status: AuditStatus;
  vorlage_id: string | null;
}

export interface Stand {
  audit_id: string;
  phasen: number;
  erledigt: number;
  entfaellt: number;
  ueberfaellig: number;
  naechster_termin: string | null;
}

export interface Phase {
  id: string;
  audit_id: string;
  position: number;
  titel: string;
  beschreibung: string;
  pflicht: boolean;
  status: PhasenStatus;
  verantwortlich: string | null;
  faellig_am: string | null;
  erledigt_am: string | null;
  kommentar: string;
  uebersprungen_warum: string | null;
}

export interface Norm {
  id: string;
  regelwerk: string;
  revision: string;
  klausel: string;
  kurztext: string;
  geprueft: boolean;
  aktiv: boolean;
}

export interface Vorlage {
  id: string;
  name: string;
  kategorie: Kategorie | null;
  beschreibung: string;
  aktiv: boolean;
}

export interface Schritt {
  id: string;
  vorlage_id: string;
  position: number;
  titel: string;
  beschreibung: string;
  pflicht: boolean;
}

export interface VerlaufZeile {
  id: number;
  entitaet: string;
  aktion: string;
  feld: string | null;
  alt: string | null;
  neu: string | null;
  grund: string | null;
  wer_email: string | null;
  wann: string;
}

/** Was die Anlage fragt — Felder und Pflicht wie im Altsystem (AUD-03). */
export interface NeuesAudit {
  nummer: string;
  titel: string;
  art: "intern" | "extern";
  kategorien: Kategorie[];
  bereich: string;
  leitender_auditor: string;
  geplant_von: string;
  geplant_bis: string;
  vorlage_id: string;
}

export type AnlageFehler = "nummer" | "titel" | "kategorie" | "zeitraum";

/** Pflicht sind Nummer, Titel und mindestens eine Kategorie; das Ende liegt
 *  nicht vor dem Beginn. Die Datenbank prüft dasselbe noch einmal. */
export function anlageFehler(
  neu: Pick<NeuesAudit, "nummer" | "titel" | "geplant_von" | "geplant_bis"> & {
    kategorien: readonly string[];
  },
): AnlageFehler[] {
  const fehler: AnlageFehler[] = [];
  if (!neu.nummer.trim()) fehler.push("nummer");
  if (!neu.titel.trim()) fehler.push("titel");
  if (neu.kategorien.length === 0) fehler.push("kategorie");
  if (neu.geplant_von && neu.geplant_bis && neu.geplant_bis < neu.geplant_von) fehler.push("zeitraum");
  return fehler;
}

/** Status- und Artfilter der Liste; leer heißt „Alle" (AUD-04). */
export function filtereAudits(
  liste: readonly Audit[],
  filter: { status: string; art: string },
): Audit[] {
  return liste.filter(
    (a) => (!filter.status || a.status === filter.status) && (!filter.art || a.art === filter.art),
  );
}

/** Was eine Phase beim Speichern braucht — dieselben zwei Bedingungen wie
 *  an der Tabelle, damit die Maske es vorher sagt. */
export function phasenFehler(
  entwurf: { status: PhasenStatus; erledigt_am: string; uebersprungen_warum: string },
  pflicht: boolean,
): "grund" | "datum" | null {
  if (entwurf.status === "nicht_zutreffend" && pflicht && !entwurf.uebersprungen_warum.trim()) {
    return "grund";
  }
  if (entwurf.status === "erledigt" && !entwurf.erledigt_am) return "datum";
  return null;
}

const AUDIT_FELDER =
  "id,nummer,titel,art,bereich,ziel,leitender_auditor,team,geplant_von," +
  "geplant_bis,prioritaet,status,vorlage_id";
const PHASE_FELDER =
  "id,audit_id,position,titel,beschreibung,pflicht,status,verantwortlich," +
  "faellig_am,erledigt_am,kommentar,uebersprungen_warum";

export const auditKeys = {
  liste: () => ["audit", "liste"] as const,
  stand: () => ["audit", "stand"] as const,
  eines: (id: string) => ["audit", "eines", id] as const,
  phasen: (id: string) => ["audit", "phasen", id] as const,
  kategorien: (id: string) => ["audit", "kategorien", id] as const,
  normbezug: (id: string) => ["audit", "normbezug", id] as const,
  alleKategorien: () => ["audit", "alleKategorien"] as const,
  verlauf: (id: string) => ["audit", "verlauf", id] as const,
  normen: () => ["audit", "normen"] as const,
  vorlagen: () => ["audit", "vorlagen"] as const,
  schritte: () => ["audit", "schritte"] as const,
};

function sb() {
  return supabaseBrowser();
}

/** Wie weit ist das Audit? Ohne Phasen gibt es nichts zu melden. */
export function fortschritt(stand: Stand | undefined): number | null {
  if (!stand || stand.phasen === 0) return null;
  const zaehlt = stand.phasen - stand.entfaellt;
  if (zaehlt === 0) return 100;
  return Math.round((stand.erledigt / zaehlt) * 100);
}

export const auditApi = {
  liste: async (): Promise<Audit[]> => {
    const { data, error } = await sb()
      .from("audits")
      .select(AUDIT_FELDER)
      .order("nummer", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Audit[];
  },

  stand: async (): Promise<Stand[]> => {
    const { data, error } = await sb().from("audit_stand").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Stand[];
  },

  eines: async (id: string): Promise<Audit | null> => {
    const { data, error } = await sb()
      .from("audits")
      .select(AUDIT_FELDER)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Audit) ?? null;
  },

  /** Audit samt Kategorien in einer Transaktion (AUD-03). Gibt die neue Kennung zurück. */
  anlegen: async (neu: NeuesAudit): Promise<string> => {
    const { data, error } = await sb().rpc("audit_anlegen", {
      p_nummer: neu.nummer.trim(),
      p_titel: neu.titel.trim(),
      p_art: neu.art,
      p_kategorien: neu.kategorien,
      p_bereich: neu.bereich.trim(),
      p_leitender_auditor: neu.leitender_auditor.trim() || null,
      p_geplant_von: neu.geplant_von || null,
      p_geplant_bis: neu.geplant_bis || null,
      p_vorlage_id: neu.vorlage_id || null,
    });
    if (error) throw new Error(error.message);
    return data as unknown as string;
  },

  /** Die Kategorien aller Audits auf einmal — für die Spalte in der Liste. */
  alleKategorien: async (): Promise<{ audit_id: string; kategorie: Kategorie }[]> => {
    const { data, error } = await sb()
      .from("audit_kategorien")
      .select("audit_id,kategorie")
      .order("audit_id")
      .order("kategorie");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { audit_id: string; kategorie: Kategorie }[];
  },

  aendern: async (id: string, felder: Partial<Audit>): Promise<void> => {
    const { data, error } = await sb()
      .from("audits")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  phasen: async (audit_id: string): Promise<Phase[]> => {
    const { data, error } = await sb()
      .from("audit_phasen")
      .select(PHASE_FELDER)
      .eq("audit_id", audit_id)
      .order("position");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Phase[];
  },

  phaseAendern: async (id: string, felder: Partial<Phase>): Promise<void> => {
    const { data, error } = await sb()
      .from("audit_phasen")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  phaseAnlegen: async (audit_id: string, titel: string, position: number) => {
    const { error } = await sb()
      .from("audit_phasen")
      .insert({ audit_id, titel, position, pflicht: false });
    if (error) throw new Error(error.message);
  },

  kategorien: async (audit_id: string): Promise<{ kategorie: Kategorie }[]> => {
    const { data, error } = await sb()
      .from("audit_kategorien")
      .select("kategorie")
      .eq("audit_id", audit_id);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { kategorie: Kategorie }[];
  },

  kategorieSetzen: async (
    audit_id: string,
    kategorie: Kategorie,
    an: boolean,
  ): Promise<void> => {
    const client = sb();
    const { error } = an
      ? await client.from("audit_kategorien").insert({ audit_id, kategorie })
      : await client
          .from("audit_kategorien")
          .delete()
          .eq("audit_id", audit_id)
          .eq("kategorie", kategorie);
    if (error) throw new Error(error.message);
  },

  normbezug: async (audit_id: string): Promise<{ norm_id: string }[]> => {
    const { data, error } = await sb()
      .from("audit_normbezug")
      .select("norm_id")
      .eq("audit_id", audit_id);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { norm_id: string }[];
  },

  normSetzen: async (audit_id: string, norm_id: string, an: boolean): Promise<void> => {
    const client = sb();
    const { error } = an
      ? await client.from("audit_normbezug").insert({ audit_id, norm_id })
      : await client
          .from("audit_normbezug")
          .delete()
          .eq("audit_id", audit_id)
          .eq("norm_id", norm_id);
    if (error) throw new Error(error.message);
  },

  verlauf: async (audit_id: string): Promise<VerlaufZeile[]> => {
    const { data, error } = await sb()
      .from("audit_verlauf")
      .select("id,entitaet,aktion,feld,alt,neu,grund,wer_email,wann")
      .eq("audit_id", audit_id)
      .order("wann", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VerlaufZeile[];
  },

  normen: async (): Promise<Norm[]> => {
    const { data, error } = await sb()
      .from("audit_normen")
      .select("id,regelwerk,revision,klausel,kurztext,geprueft,aktiv")
      .order("regelwerk")
      .order("klausel");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Norm[];
  },

  normAnlegen: async (felder: Partial<Norm>): Promise<void> => {
    const { error } = await sb().from("audit_normen").insert(felder);
    if (error) throw new Error(error.message);
  },

  normAendern: async (id: string, felder: Partial<Norm>): Promise<void> => {
    const { error } = await sb().from("audit_normen").update(felder).eq("id", id);
    if (error) throw new Error(error.message);
  },

  vorlagen: async (): Promise<Vorlage[]> => {
    const { data, error } = await sb()
      .from("audit_vorlagen")
      .select("id,name,kategorie,beschreibung,aktiv")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Vorlage[];
  },

  vorlageAnlegen: async (name: string): Promise<void> => {
    const { error } = await sb().from("audit_vorlagen").insert({ name });
    if (error) throw new Error(error.message);
  },

  schritte: async (): Promise<Schritt[]> => {
    const { data, error } = await sb()
      .from("audit_vorlage_schritte")
      .select("id,vorlage_id,position,titel,beschreibung,pflicht")
      .order("vorlage_id")
      .order("position");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Schritt[];
  },

  schrittAnlegen: async (
    vorlage_id: string,
    position: number,
    titel: string,
  ): Promise<void> => {
    const { error } = await sb()
      .from("audit_vorlage_schritte")
      .insert({ vorlage_id, position, titel });
    if (error) throw new Error(error.message);
  },

  schrittLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("audit_vorlage_schritte").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};
