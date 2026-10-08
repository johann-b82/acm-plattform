"use client";

import { useQuery } from "@tanstack/react-query";

import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Steuerung und Überwachung des ODBC-Workers (die Windows-VM, die Apollo liest).
 *
 * Drei Tabellen (Migration 0068), alle nur für `platform:admin` sichtbar:
 *  - `odbc_worker_konfig`  — die Oberfläche schreibt, der Worker liest sie per
 *    `GET /api/odbc/konfig`. Intervall, aktive Arten, „jetzt synchronisieren".
 *  - `odbc_worker_status`  — der Worker meldet Herzschlag; nur lesbar.
 *  - `odbc_sync_lauf`      — letzter Lauf je Art; nur lesbar.
 *
 * Der Worker ist „online", wenn sein letzter Herzschlag jünger als das Doppelte
 * des Intervalls ist (ein verpasster Lauf ist noch kein Ausfall).
 */

/** Die vom Worker bedienten Arten (mit bestätigtem/ableitbarem Mapping). Die
 *  drei offenen (kontakte/interessenten/liefertreue) fehlen bewusst. */
export const WORKER_ARTEN = [
  "umsatz",
  "auftraege",
  "angebote",
  "lagerpreise",
  "acht_d",
  "auftragspositionen",
  "lieferscheine",
  "wareneingaenge",
  "materialpreise",
  "lagerbewegungen",
  "pruefungen",
  "liefertreue",
] as const;

export type WorkerArt = (typeof WORKER_ARTEN)[number];

export interface WorkerKonfig {
  intervall_min: number;
  aktive_arten: string[];
  sync_angefordert_am: string | null;
}

export interface WorkerStatus {
  gesehen_am: string | null;
  worker_version: string | null;
  host: string | null;
  sync_bestaetigt_am: string | null;
  letzter_fehler: string | null;
}

export interface SyncLauf {
  art: string;
  gelaufen_am: string;
  status: "ok" | "fehler";
  zeilen: number | null;
  dauer_ms: number | null;
  fehler: string | null;
}

export const workerKeys = {
  konfig: () => ["odbc-worker-konfig"] as const,
  status: () => ["odbc-worker-status"] as const,
  laeufe: () => ["odbc-sync-laeufe"] as const,
};

async function konfigSchreiben(werte: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabaseBrowser()
    .from("odbc_worker_konfig")
    .update({ ...werte, geaendert_am: new Date().toISOString() })
    .eq("id", true)
    .select("id");
  if (error || !data?.length) throw new Error(error?.message ?? "Nicht gespeichert — fehlt das Recht?");
}

export const workerApi = {
  konfigLesen: async (): Promise<WorkerKonfig> => {
    const { data, error } = await supabaseBrowser()
      .from("odbc_worker_konfig")
      .select("intervall_min,aktive_arten,sync_angefordert_am")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      intervall_min: data?.intervall_min ?? 60,
      aktive_arten: Array.isArray(data?.aktive_arten) ? (data!.aktive_arten as string[]) : [],
      sync_angefordert_am: data?.sync_angefordert_am ?? null,
    };
  },

  statusLesen: async (): Promise<WorkerStatus | null> => {
    const { data, error } = await supabaseBrowser()
      .from("odbc_worker_status")
      .select("gesehen_am,worker_version,host,sync_bestaetigt_am,letzter_fehler")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as WorkerStatus | null) ?? null;
  },

  laeufeLesen: async (): Promise<SyncLauf[]> => {
    const { data, error } = await supabaseBrowser()
      .from("odbc_sync_lauf")
      .select("art,gelaufen_am,status,zeilen,dauer_ms,fehler");
    if (error) throw new Error(error.message);
    return (data as SyncLauf[] | null) ?? [];
  },

  intervallSetzen: (min: number) => konfigSchreiben({ intervall_min: min }),
  artenSetzen: (arten: string[]) => konfigSchreiben({ aktive_arten: arten }),
  /** „Jetzt synchronisieren": setzt den Auftragszeitstempel; der Worker läuft
   *  beim nächsten Poll außer der Reihe und bestätigt über den Herzschlag. */
  syncJetzt: () => konfigSchreiben({ sync_angefordert_am: new Date().toISOString() }),
};

/** Online, wenn der Herzschlag jünger als 2× Intervall (mind. 10 min) ist. */
export function istOnline(status: WorkerStatus | null, intervallMin: number): boolean {
  if (!status?.gesehen_am) return false;
  const alterMs = Date.now() - new Date(status.gesehen_am).getTime();
  const grenzeMs = Math.max(intervallMin * 2, 10) * 60_000;
  return alterMs <= grenzeMs;
}

export function useWorkerKonfig() {
  return useQuery({ queryKey: workerKeys.konfig(), queryFn: workerApi.konfigLesen });
}

export function useWorkerStatus() {
  return useQuery({
    queryKey: workerKeys.status(),
    queryFn: workerApi.statusLesen,
    refetchInterval: 30_000,
  });
}

export function useSyncLaeufe() {
  return useQuery({
    queryKey: workerKeys.laeufe(),
    queryFn: workerApi.laeufeLesen,
    refetchInterval: 30_000,
  });
}
