"use client";

import { useQuery } from "@tanstack/react-query";

import { supabaseBrowser } from "@/lib/supabase/client";
import { SEITENGROESSEN, type Seitengroesse } from "@/lib/tabelle";

/**
 * Was für die ganze Plattform gilt und an keiner Person hängt.
 *
 * Eine Zeile in `plattform_einstellungen`. Lesen darf jeder Angemeldete,
 * setzen nur die Plattform-Verwaltung — die Policy prüft das, nicht diese
 * Datei.
 */
export interface PlattformEinstellungen {
  tabellen_seitengroesse: Seitengroesse;
}

export const plattformKeys = { alle: () => ["plattform-einstellungen"] as const };

export const plattformApi = {
  lesen: async (): Promise<PlattformEinstellungen> => {
    const { data, error } = await supabaseBrowser()
      .from("plattform_einstellungen")
      .select("tabellen_seitengroesse")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as PlattformEinstellungen | null) ?? { tabellen_seitengroesse: 25 };
  },

  seitengroesseSetzen: async (groesse: Seitengroesse): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("plattform_einstellungen")
      .update({ tabellen_seitengroesse: groesse, geaendert_am: new Date().toISOString() })
      .eq("id", true)
      .select("tabellen_seitengroesse");
    // Eine abgewiesene Änderung meldet Postgres als `UPDATE 0`, nicht als Fehler.
    if (error || !data?.length) throw new Error(error?.message ?? "Nicht gespeichert — fehlt das Recht?");
  },
};

/** Die zentrale Seitengröße. Bis sie geladen ist, gilt die Vorgabe 25. */
export function useSeitengroesse(): Seitengroesse {
  const { data } = useQuery({
    queryKey: plattformKeys.alle(),
    queryFn: plattformApi.lesen,
    staleTime: 5 * 60_000,
  });
  const wert = data?.tabellen_seitengroesse;
  return wert && (SEITENGROESSEN as readonly number[]).includes(wert) ? wert : 25;
}
