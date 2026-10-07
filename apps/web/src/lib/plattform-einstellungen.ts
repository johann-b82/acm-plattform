"use client";

import { useQuery } from "@tanstack/react-query";

import { supabaseBrowser } from "@/lib/supabase/client";
import { SEITENGROESSEN, type Seitengroesse } from "@/lib/tabelle";
import { STANDARD_ERSCHEINUNG, erscheinungAus, type Erscheinung } from "@/lib/kontrast";

/**
 * Was für die ganze Plattform gilt und an keiner Person hängt.
 *
 * Eine Zeile in `plattform_einstellungen`. Lesen darf jeder Angemeldete,
 * setzen nur die Plattform-Verwaltung — die Policy prüft das, nicht diese
 * Datei. Neben der Seitengröße stehen hier App-Name und Farbrollen (SET-06)
 * sowie der Personio-Takt und die Nachweisübertragung (SET-08/09).
 */
/** Woher die Kennzahlen kommen: die monatlichen Extrakt-Uploads oder der
 *  ODBC-Worker, der Apollo live liest. Bei „odbc" sind die manuellen Importe
 *  gesperrt (die compute-Seite weist sie mit 409 ab). */
export type Datenquelle = "extrakte" | "odbc";

export interface PlattformEinstellungen {
  tabellen_seitengroesse: Seitengroesse;
  app_name: string;
  erscheinung: Erscheinung;
  personio_sync_intervall_h: number;
  personio_nachweis_aktiv: boolean;
  personio_nachweis_kategorie: string;
  datenquelle: Datenquelle;
}

interface Roh {
  tabellen_seitengroesse: number | null;
  app_name: string | null;
  farben: unknown;
  personio_sync_intervall_h: number | null;
  personio_nachweis_aktiv: boolean | null;
  personio_nachweis_kategorie: string | null;
  datenquelle: string | null;
}

export const plattformKeys = { alle: () => ["plattform-einstellungen"] as const };

const SPALTEN =
  "tabellen_seitengroesse,app_name,farben,personio_sync_intervall_h," +
  "personio_nachweis_aktiv,personio_nachweis_kategorie,datenquelle";

function ausRoh(roh: Roh | null): PlattformEinstellungen {
  const groesse = roh?.tabellen_seitengroesse;
  return {
    tabellen_seitengroesse:
      groesse && (SEITENGROESSEN as readonly number[]).includes(groesse) ? (groesse as Seitengroesse) : 25,
    app_name: roh?.app_name?.trim() || "ACM-Plattform",
    erscheinung: roh?.farben != null ? erscheinungAus(roh.farben) : STANDARD_ERSCHEINUNG,
    personio_sync_intervall_h: roh?.personio_sync_intervall_h ?? 24,
    personio_nachweis_aktiv: roh?.personio_nachweis_aktiv ?? false,
    personio_nachweis_kategorie: roh?.personio_nachweis_kategorie ?? "",
    datenquelle: roh?.datenquelle === "odbc" ? "odbc" : "extrakte",
  };
}

async function schreiben(werte: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabaseBrowser()
    .from("plattform_einstellungen")
    .update({ ...werte, geaendert_am: new Date().toISOString() })
    .eq("id", true)
    .select("id");
  // Eine abgewiesene Änderung meldet Postgres als `UPDATE 0`, nicht als Fehler.
  if (error || !data?.length) throw new Error(error?.message ?? "Nicht gespeichert — fehlt das Recht?");
}

export const plattformApi = {
  lesen: async (): Promise<PlattformEinstellungen> => {
    const { data, error } = await supabaseBrowser()
      .from("plattform_einstellungen")
      .select(SPALTEN)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return ausRoh(data as Roh | null);
  },

  seitengroesseSetzen: (groesse: Seitengroesse) => schreiben({ tabellen_seitengroesse: groesse }),

  /** App-Name und Farbrollen (SET-06). `null` als Farben stellt die Vorgabe her. */
  erscheinungSetzen: (app_name: string, farben: Erscheinung | null) =>
    schreiben({ app_name: app_name.trim(), farben }),

  personioTaktSetzen: (stunden: number) => schreiben({ personio_sync_intervall_h: stunden }),

  nachweisSetzen: (aktiv: boolean, kategorie: string) =>
    schreiben({ personio_nachweis_aktiv: aktiv, personio_nachweis_kategorie: kategorie.trim() || null }),

  datenquelleSetzen: (quelle: Datenquelle) => schreiben({ datenquelle: quelle }),
};

/** Die zentrale Seitengröße. Bis sie geladen ist, gilt die Vorgabe 25. */
export function useSeitengroesse(): Seitengroesse {
  const { data } = useQuery({
    queryKey: plattformKeys.alle(),
    queryFn: plattformApi.lesen,
    staleTime: 5 * 60_000,
  });
  return data?.tabellen_seitengroesse ?? 25;
}

/** Die aktive KPI-Datenquelle. Bis sie geladen ist, gilt „extrakte". */
export function useDatenquelle(): Datenquelle {
  const { data } = useQuery({
    queryKey: plattformKeys.alle(),
    queryFn: plattformApi.lesen,
    staleTime: 5 * 60_000,
  });
  return data?.datenquelle ?? "extrakte";
}
