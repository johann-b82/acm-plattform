import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Onboarding: Eintritte und ihr abgeleiteter Schulungsplan.
 *
 * Alles über PostgREST — auch die Ableitung. Sie ist ein Verbund aus
 * Anforderungsmatrix, Rollenzuordnung und Bestand und steht deshalb als
 * Funktion in der Datenbank, nicht als Rechnung im Dienst.
 */

export interface Eintritt {
  employee_id: number | null;
  extern_id: string | null;
  name: string;
  abteilung: string | null;
  abteilung_gesetzt: boolean;
  position: string | null;
  eintritt: string | null;
  status: string | null;
  heruntergeladen_am: string | null;
}

export interface Planzeile {
  schulung_id: string | null;
  bereich: string | null;
  name: string | null;
  turnus: string | null;
  /** `personio`, `kuerzel` — oder `kuerzel_fehlt` als Hinweis. */
  quelle: string;
  abteilung: string | null;
  vorhanden: boolean;
}

export interface Rolle {
  id: string;
  position: string;
  position_norm: string;
  abteilung_kuerzel: string;
}

export const onboardingKeys = {
  eintritte: () => ["onboarding", "eintritte"] as const,
  plan: (id: number) => ["onboarding", "plan", id] as const,
  rollen: () => ["onboarding", "rollen"] as const,
};

function sb() {
  return supabaseBrowser();
}

/** Wie lange gilt jemand als „neu"? */
export const NEU_TAGE = 90;

export function istNeu(eintritt: Eintritt, heute = new Date()): boolean {
  if (eintritt.heruntergeladen_am) return false;
  if (!eintritt.eintritt) return false;
  const tage = (heute.getTime() - new Date(eintritt.eintritt).getTime()) / 86_400_000;
  return tage >= -30 && tage <= NEU_TAGE;
}

export const onboardingApi = {
  eintritte: async (): Promise<Eintritt[]> => {
    const { data, error } = await sb()
      .from("onboarding_eintritte")
      .select("*")
      .order("eintritt", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Eintritt[];
  },

  plan: async (employee_id: number): Promise<Planzeile[]> => {
    const { data, error } = await sb().rpc("schulungsplan", {
      p_employee_id: employee_id,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Planzeile[];
  },

  /** Die fehlenden Pflichtschulungen als offene Zeilen anlegen. */
  planAnlegen: async (employee_id: number): Promise<number> => {
    const { data, error } = await sb().rpc("schulungsplan_anlegen", {
      p_employee_id: employee_id,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  },

  abteilungSetzen: async (employee_id: number, abteilung: string | null): Promise<void> => {
    const client = sb();
    const { error } = abteilung
      ? await client
          .from("onboarding_abteilung")
          .upsert({ employee_id, abteilung, geaendert_am: new Date().toISOString() })
      : await client.from("onboarding_abteilung").delete().eq("employee_id", employee_id);
    if (error) throw new Error(error.message);
  },

  paketVermerken: async (eintritt: Eintritt): Promise<void> => {
    const { error } = await sb()
      .from("onboarding_paket")
      .insert(
        eintritt.employee_id !== null
          ? { employee_id: eintritt.employee_id }
          : { extern_id: eintritt.extern_id },
      );
    if (error) throw new Error(error.message);
  },

  externAnlegen: async (felder: {
    name: string;
    abteilung: string | null;
    position: string | null;
    eintritt: string | null;
  }): Promise<void> => {
    const { error } = await sb().from("externe_personen").insert(felder);
    if (error) throw new Error(error.message);
  },

  externLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("externe_personen").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  rollen: async (): Promise<Rolle[]> => {
    const { data, error } = await sb()
      .from("schulung_rollen")
      .select("id,position,position_norm,abteilung_kuerzel")
      .order("position");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Rolle[];
  },

  rolleSetzen: async (position: string, abteilung_kuerzel: string): Promise<void> => {
    const { error } = await sb().from("schulung_rollen").upsert(
      {
        position,
        position_norm: position.replace(/\s+/g, " ").trim().toLowerCase(),
        abteilung_kuerzel,
      },
      { onConflict: "position_norm" },
    );
    if (error) throw new Error(error.message);
  },

  rolleLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("schulung_rollen").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};
