import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Newsletter: eine Ausgabe je Quartal, darin Kapitel, darin Einträge.
 *
 * Reines Lesen und Schreiben über PostgREST, Bilder über Supabase Storage.
 * `compute` kommt nicht vor — auch das PDF nicht, das im Browser aus der
 * gerenderten Ansicht entsteht (siehe `pdf.ts`).
 *
 * Kapitel sind Zeilen mit Titel, Sortierung und Art. Das Altprojekt hat sechs
 * Rubriken als Konstante im Code und zwei JSONB-Spalten, die sie überschreiben;
 * hier gibt es nur die Zeilen.
 */

export const EIMER = "newsletter";
export const MAX_BILD_BYTES = 10 * 1024 * 1024;
export const ERLAUBTE_BILDTYPEN = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type Status = "entwurf" | "veroeffentlicht";
export type KapitelArt = "eintraege" | "kpi" | "neuzugaenge";

export const ART_LABEL: Record<KapitelArt, string> = {
  eintraege: "Beiträge",
  kpi: "Belegschaft in Zahlen",
  neuzugaenge: "Neu bei uns",
};

export interface Ausgabe {
  id: string;
  jahr: number;
  quartal: number;
  titel: string | null;
  status: Status;
  titelbild: string | null;
  rueckseite: string | null;
  geaendert_am: string;
}

export interface Bild {
  id: string;
  eintrag_id: string;
  pfad: string;
  spalten: number;
  zeilen: number;
  sortierung: number;
}

export interface Eintrag {
  id: string;
  kapitel_id: string;
  untertitel: string;
  inhalt_md: string;
  sortierung: number;
  newsletter_bild: Bild[];
}

/** Belegschaftszahlen, wie sie beim Einfrieren aussahen. */
export interface KpiStand {
  stichtag: string;
  gesamt: number;
  neu: number;
  bestand: number;
  verteilung: { art: string; kategorie: string; anzahl: number }[];
}

export interface Neuzugang {
  vorname: string | null;
  nachname: string | null;
  abteilung: string | null;
  hire_date: string | null;
}

export interface Kapitel {
  id: string;
  newsletter_id: string;
  titel: string;
  art: KapitelArt;
  stand: KpiStand | Neuzugang[] | null;
  sortierung: number;
  newsletter_eintrag: Eintrag[];
}

/** Das Quartal, in das ein Tag fällt — Vorgabe für eine neue Ausgabe. */
export function quartalVon(tag: Date): number {
  return Math.floor(tag.getMonth() / 3) + 1;
}

export const newsletterKeys = {
  ausgaben: () => ["newsletter", "ausgaben"] as const,
  ausgabe: (id: string) => ["newsletter", "ausgabe", id] as const,
  kapitel: (id: string) => ["newsletter", "kapitel", id] as const,
};

function pruefeBetroffen(daten: unknown[] | null): void {
  if (!daten?.length) {
    throw new Error("Nicht gespeichert — fehlt das Recht, den Newsletter zu bearbeiten?");
  }
}

const AUSGABE_FELDER = "id,jahr,quartal,titel,status,titelbild,rueckseite,geaendert_am";

/** Ein Objektname beginnt mit der eigenen Kennung, sonst weist die Regel auf
 *  `storage.objects` den Upload ab. */
async function hochladen(datei: File): Promise<string> {
  if (datei.size > MAX_BILD_BYTES) {
    throw new Error("Das Bild ist größer als 10 MB.");
  }
  if (!ERLAUBTE_BILDTYPEN.includes(datei.type)) {
    throw new Error(`Bildformat nicht erlaubt: ${datei.type || "unbekannt"}`);
  }
  const sb = supabaseBrowser();
  const { data: sitzung } = await sb.auth.getUser();
  const kennung = sitzung.user?.id;
  if (!kennung) throw new Error("Keine Sitzung.");
  const endung = datei.name.split(".").pop()?.toLowerCase() || "jpg";
  const pfad = `${kennung}/${crypto.randomUUID()}.${endung}`;
  const { error } = await sb.storage
    .from(EIMER)
    .upload(pfad, datei, { contentType: datei.type });
  if (error) throw new Error(error.message);
  return pfad;
}

export const newsletterApi = {
  ausgaben: async (): Promise<Ausgabe[]> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter")
      .select(AUSGABE_FELDER)
      .order("jahr", { ascending: false })
      .order("quartal", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Ausgabe[];
  },

  ausgabe: async (id: string): Promise<Ausgabe | null> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter")
      .select(AUSGABE_FELDER)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Ausgabe) ?? null;
  },

  /** Kapitel samt Einträgen und Bildern in einem Zug. Die Leseregeln der
   *  Kindtabellen fragen jeweils den Elternteil, die Verschachtelung ist
   *  also nicht weiter als das, was ohnehin sichtbar ist. */
  kapitel: async (newsletterId: string): Promise<Kapitel[]> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter_kapitel")
      .select(
        "id,newsletter_id,titel,art,stand,sortierung," +
          "newsletter_eintrag(id,kapitel_id,untertitel,inhalt_md,sortierung," +
          "newsletter_bild(id,eintrag_id,pfad,spalten,zeilen,sortierung))",
      )
      .eq("newsletter_id", newsletterId)
      .order("sortierung");
    if (error) throw new Error(error.message);
    const kapitel = (data ?? []) as unknown as Kapitel[];
    // PostgREST sortiert eingebettete Zeilen nicht mit; das machen wir hier.
    for (const k of kapitel) {
      k.newsletter_eintrag.sort((a, b) => a.sortierung - b.sortierung);
      for (const e of k.newsletter_eintrag) {
        e.newsletter_bild.sort((a, b) => a.sortierung - b.sortierung);
      }
    }
    return kapitel;
  },

  /** Kurzlebige URLs für viele Bilder auf einmal. Einzeln signiert wäre es
   *  eine Anfrage je Bild, und eine Ausgabe hat leicht zwanzig. */
  bildUrls: async (pfade: string[]): Promise<Record<string, string>> => {
    if (pfade.length === 0) return {};
    const { data, error } = await supabaseBrowser()
      .storage.from(EIMER)
      .createSignedUrls(pfade, 1800);
    if (error) throw new Error(error.message);
    const karte: Record<string, string> = {};
    for (const eintrag of data ?? []) {
      if (eintrag.signedUrl && eintrag.path) karte[eintrag.path] = eintrag.signedUrl;
    }
    return karte;
  },

  ausgabeAnlegen: async (jahr: number, quartal: number): Promise<Ausgabe> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter")
      .insert({ jahr, quartal })
      .select(AUSGABE_FELDER);
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
    return data![0] as unknown as Ausgabe;
  },

  ausgabeAendern: async (id: string, felder: Partial<Ausgabe>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  ausgabeLoeschen: async (id: string): Promise<void> => {
    // Die Bilder der Ausgabe zuerst: die Zeilen gehen per Kaskade mit, die
    // Dateien nicht.
    const kapitel = await newsletterApi.kapitel(id);
    const pfade = kapitel.flatMap((k) =>
      k.newsletter_eintrag.flatMap((e) => e.newsletter_bild.map((b) => b.pfad)),
    );
    const sb = supabaseBrowser();
    const alleBilder = [...pfade];
    const kopf = await newsletterApi.ausgabe(id);
    if (kopf?.titelbild) alleBilder.push(kopf.titelbild);
    if (kopf?.rueckseite) alleBilder.push(kopf.rueckseite);
    if (alleBilder.length) {
      const { error } = await sb.storage.from(EIMER).remove(alleBilder);
      if (error) throw new Error(error.message);
    }
    const { data, error } = await sb.from("newsletter").delete().eq("id", id).select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Titelbild oder Rückseite setzen. Ein vorhandenes Bild wird ersetzt und
   *  weggeräumt — sonst bliebe es im Eimer liegen. */
  deckblattSetzen: async (
    ausgabe: Ausgabe,
    feld: "titelbild" | "rueckseite",
    datei: File,
  ): Promise<void> => {
    const pfad = await hochladen(datei);
    await newsletterApi.ausgabeAendern(ausgabe.id, { [feld]: pfad } as Partial<Ausgabe>);
    const alt = ausgabe[feld];
    if (alt) await supabaseBrowser().storage.from(EIMER).remove([alt]);
  },

  kapitelAnlegen: async (
    newsletterId: string,
    titel: string,
    art: KapitelArt,
    sortierung: number,
  ): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter_kapitel")
      .insert({ newsletter_id: newsletterId, titel, art, sortierung })
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  kapitelAendern: async (id: string, felder: Partial<Kapitel>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter_kapitel")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  kapitelLoeschen: async (kapitel: Kapitel): Promise<void> => {
    const pfade = kapitel.newsletter_eintrag.flatMap((e) =>
      e.newsletter_bild.map((b) => b.pfad),
    );
    const sb = supabaseBrowser();
    if (pfade.length) {
      const { error } = await sb.storage.from(EIMER).remove(pfade);
      if (error) throw new Error(error.message);
    }
    const { data, error } = await sb
      .from("newsletter_kapitel")
      .delete()
      .eq("id", kapitel.id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Friert ein, was die Ausgabe aus dem Personalbestand zeigt. Verlangt je
   *  nach Art zusätzlich das Kennzahlen- oder das Personalrecht — die
   *  Funktion in der Datenbank prüft es selbst. */
  einfrieren: async (kapitel: Kapitel): Promise<void> => {
    const funktion =
      kapitel.art === "kpi"
        ? "newsletter_kpi_einfrieren"
        : "newsletter_neuzugaenge_einfrieren";
    const { error } = await supabaseBrowser().rpc(funktion, { p_kapitel: kapitel.id });
    if (error) throw new Error(error.message);
  },

  eintragAnlegen: async (kapitelId: string, sortierung: number): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter_eintrag")
      .insert({ kapitel_id: kapitelId, untertitel: "", sortierung })
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  eintragAendern: async (id: string, felder: Partial<Eintrag>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter_eintrag")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  eintragLoeschen: async (eintrag: Eintrag): Promise<void> => {
    const sb = supabaseBrowser();
    if (eintrag.newsletter_bild.length) {
      const { error } = await sb.storage
        .from(EIMER)
        .remove(eintrag.newsletter_bild.map((b) => b.pfad));
      if (error) throw new Error(error.message);
    }
    const { data, error } = await sb
      .from("newsletter_eintrag")
      .delete()
      .eq("id", eintrag.id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  bildHinzufuegen: async (
    eintragId: string,
    datei: File,
    sortierung: number,
  ): Promise<void> => {
    const pfad = await hochladen(datei);
    const { data, error } = await supabaseBrowser()
      .from("newsletter_bild")
      .insert({ eintrag_id: eintragId, pfad, sortierung })
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  bildAendern: async (id: string, felder: Partial<Bild>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("newsletter_bild")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Datei vor Zeile — bleibt die Zeile stehen, ist nichts verloren;
   *  umgekehrt bliebe ein Bild liegen, das niemand mehr findet. */
  bildLoeschen: async (bild: Bild): Promise<void> => {
    const sb = supabaseBrowser();
    const { error: speicherFehler } = await sb.storage.from(EIMER).remove([bild.pfad]);
    if (speicherFehler) throw new Error(speicherFehler.message);
    const { data, error } = await sb
      .from("newsletter_bild")
      .delete()
      .eq("id", bild.id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },
};
