import { computeJson } from "@/lib/compute";
import { rpc, takt } from "@/lib/kpi/gemeinsam";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Personalkennzahlen. Rechenwege als SQL-Funktionen in Alembic 0013.
 *
 * Die vier Funktionen sind `security definer` und geben nur Aggregate her.
 * Die Personenzeilen selbst hängen an der Berechtigung `hr` — deshalb kann
 * ein Finanz-Dashboard später die Personalkostenquote zeigen, ohne dass der
 * Betrachter Gehälter und Geburtsdaten sehen darf.
 *
 * Die Argumentnamen tragen `p_`: in `language sql` löst Postgres einen
 * Parameter, der wie eine Spalte heißt, als Spalte auf — der Filter greift
 * dann ins Leere, ohne dass irgendetwas scheitert.
 */

export interface Ueberstunden {
  ist_stunden: number;
  ueberstunden: number;
  quote: number | null;
  personen: number;
}

export interface Krankheit {
  krank_stunden: number;
  soll_stunden: number;
  quote: number | null;
  eingerichtet: boolean;
}

export interface Fluktuation {
  austritte: number;
  bestand_schnitt: number;
  quote: number | null;
}

export interface VerlaufPunkt {
  bucket: string;
  ueberstunden_quote: number | null;
  krankheits_quote: number | null;
}

/** Letzter Lauf des Personio-Abgleichs. Liest direkt über PostgREST. */
export interface Abgleichstand {
  gelaufen_am: string;
  status: string;
  fehler: string | null;
  mitarbeiter: number;
  anwesenheiten: number;
  abwesenheiten: number;
  dauer_sekunden: number | null;
}

/** Eine Zeile des Wochenberichts. Trägt Namen — nur für `hr:admin`. */
export interface WochenZeile {
  employee_id: number;
  name: string | null;
  ist_stunden: number;
  soll_stunden: number;
  netto: number;
  krank_tage: number;
  krank_stunden: number;
}

export interface WocheMitDaten {
  iso_jahr: number;
  iso_woche: number;
  tage: number;
}

function zahl(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function quote(v: unknown): number | null {
  return v == null ? null : Number(v);
}

export const personalApi = {
  ueberstunden: async (von: string, bis: string): Promise<Ueberstunden> => {
    const rows = await rpc<Ueberstunden[]>("kpi_hr_ueberstunden", { p_von: von, p_bis: bis });
    const r = rows[0];
    return {
      ist_stunden: zahl(r?.ist_stunden),
      ueberstunden: zahl(r?.ueberstunden),
      quote: quote(r?.quote),
      personen: zahl(r?.personen),
    };
  },

  krankheit: async (von: string, bis: string): Promise<Krankheit> => {
    const rows = await rpc<Krankheit[]>("kpi_hr_krankheit", { p_von: von, p_bis: bis });
    const r = rows[0];
    return {
      krank_stunden: zahl(r?.krank_stunden),
      soll_stunden: zahl(r?.soll_stunden),
      quote: quote(r?.quote),
      eingerichtet: Boolean(r?.eingerichtet),
    };
  },

  fluktuation: async (von: string, bis: string): Promise<Fluktuation> => {
    const rows = await rpc<Fluktuation[]>("kpi_hr_fluktuation", { p_von: von, p_bis: bis });
    const r = rows[0];
    return {
      austritte: zahl(r?.austritte),
      bestand_schnitt: zahl(r?.bestand_schnitt),
      quote: quote(r?.quote),
    };
  },

  verlauf: async (von: string, bis: string): Promise<VerlaufPunkt[]> => {
    const rows = await rpc<VerlaufPunkt[]>("kpi_hr_verlauf", {
      p_von: von,
      p_bis: bis,
      p_takt: takt(von, bis),
    });
    return rows.map((r) => ({
      bucket: r.bucket,
      ueberstunden_quote: quote(r.ueberstunden_quote),
      krankheits_quote: quote(r.krankheits_quote),
    }));
  },

  /** Der letzte Lauf. `null`, wenn noch nie einer stattgefunden hat. */
  abgleichstand: async (): Promise<Abgleichstand | null> => {
    const { data, error } = await supabaseBrowser()
      .from("personio_sync_meta")
      .select("gelaufen_am,status,fehler,mitarbeiter,anwesenheiten,abwesenheiten,dauer_sekunden")
      .order("gelaufen_am", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0] as Abgleichstand | undefined) ?? null;
  },

  /**
   * Wochenbericht. Die Funktion prüft `hr:admin` selbst und gibt sonst keine
   * Zeilen zurück — die Oberfläche blendet nur aus, was die Datenbank ohnehin
   * verweigert.
   */
  wochenbericht: async (jahr: number, woche: number): Promise<WochenZeile[]> => {
    const rows = await rpc<WochenZeile[]>("kpi_hr_wochenbericht", {
      p_jahr: jahr,
      p_woche: woche,
    });
    return rows.map((r) => ({
      ...r,
      ist_stunden: zahl(r.ist_stunden),
      soll_stunden: zahl(r.soll_stunden),
      netto: zahl(r.netto),
      krank_tage: zahl(r.krank_tage),
      krank_stunden: zahl(r.krank_stunden),
    }));
  },

  wochenMitDaten: async (grenze = 26): Promise<WocheMitDaten[]> => {
    const rows = await rpc<WocheMitDaten[]>("kpi_hr_wochen_mit_daten", { p_grenze: grenze });
    return rows.map((r) => ({
      iso_jahr: Number(r.iso_jahr),
      iso_woche: Number(r.iso_woche),
      tage: zahl(r.tage),
    }));
  },

  /** Abgleich sofort ausführen. Braucht `hr:admin`; dauert Minuten. */
  abgleichAnstossen: () =>
    computeJson<{ status: string; mitarbeiter: number; anwesenheiten: number; abwesenheiten: number }>(
      "/api/hr/sync",
      { method: "POST" },
    ),
};

export const personalKeys = {
  alle: () => ["kpi", "personal"] as const,
  fenster: (von: string, bis: string) => ["kpi", "personal", von, bis] as const,
  abgleich: () => ["kpi", "personal", "abgleich"] as const,
  wochen: () => ["kpi", "personal", "wochen"] as const,
  woche: (jahr: number, w: number) => ["kpi", "personal", "woche", jahr, w] as const,
};
