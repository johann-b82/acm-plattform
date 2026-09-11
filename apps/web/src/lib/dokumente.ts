"use client";

import { computeFetch, computeJson } from "@/lib/compute";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Der Dokumentenlauf: ein Blatt, sein Weg und die Prüfung des Scans.
 *
 * Zwei Formblätter gehen im Haus denselben Weg — der Einarbeitungsplan und der
 * Schulungsnachweis. Sie werden gedruckt, ausgehändigt, von Hand ausgefüllt,
 * unterschrieben zurückgegeben und abgeheftet. Ein heruntergeladenes PDF wäre
 * danach weg; niemand wüsste, ob es zurückkam und ob es vollständig ist. Genau
 * das fragt das Audit.
 *
 * Lesen geht über PostgREST, das Erzeugen und Prüfen über compute — dafür
 * braucht es QR-Code, PDF-Satz und Bildrechnung.
 */

export type Art = "einarbeitung" | "schulung";
export type Stand = "erstellt" | "uebergeben" | "zurueck" | "geprueft";

/** Die Stationen in ihrer Reihenfolge — dieselbe wie in der Datenbank. */
export const WEG: Stand[] = ["erstellt", "uebergeben", "zurueck", "geprueft"];

export const STAND_LABEL: Record<Stand, string> = {
  erstellt: "erstellt",
  uebergeben: "übergeben",
  zurueck: "zurück",
  geprueft: "geprüft",
};

export const ART_LABEL: Record<Art, string> = {
  einarbeitung: "Einarbeitungsplan",
  schulung: "Schulungsnachweis",
};

export interface Feld {
  key: string;
  label: string;
  erkannt: boolean;
  netto_px: number;
  anteil: number;
}

export interface PruefErgebnis {
  qr_ok: boolean;
  doc_uid: string | null;
  felder: Feld[];
  vollstaendig: boolean;
  fehlend: string[];
}

export interface Vorgang {
  id: string;
  art: Art;
  doc_uid: string;
  employee_id: number | null;
  extern_id: string | null;
  name: string;
  funktion: string | null;
  status: Stand;
  erstellt_am: string;
  uebergeben_am: string | null;
  zurueck_am: string | null;
  geprueft_am: string | null;
  vollstaendig: boolean | null;
  kommentar: string | null;
  pruef_ergebnis: PruefErgebnis | null;
  scan_pfad: string | null;
}

export interface Nachweis {
  id: string;
  vorgang_id: string;
  zeile: string | null;
  dateiname: string;
  hochgeladen_am: string;
}

const FELDER =
  "id,art,doc_uid,employee_id,extern_id,name,funktion,status,erstellt_am," +
  "uebergeben_am,zurueck_am,geprueft_am,vollstaendig,kommentar,pruef_ergebnis,scan_pfad";

export const dokumentKeys = {
  liste: () => ["dokumente", "liste"] as const,
  nachweise: (id: string) => ["dokumente", id, "nachweise"] as const,
};

function sb() {
  return supabaseBrowser();
}

/** Die nächste Station — oder nichts, wenn der Vorgang durch ist. */
export function naechste(stand: Stand): Stand | null {
  const i = WEG.indexOf(stand);
  return i >= 0 && i < WEG.length - 1 ? WEG[i + 1] : null;
}

export const dokumentApi = {
  liste: async (): Promise<Vorgang[]> => {
    const { data, error } = await sb()
      .from("dokumentvorgaenge")
      .select(FELDER)
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Vorgang[];
  },

  nachweise: async (vorgang_id: string): Promise<Nachweis[]> => {
    const { data, error } = await sb()
      .from("dokument_nachweise")
      .select("id,vorgang_id,zeile,dateiname,hochgeladen_am")
      .eq("vorgang_id", vorgang_id)
      .order("hochgeladen_am");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Nachweis[];
  },

  anlegen: (eingabe: {
    art: Art;
    employee_id?: number | null;
    extern_id?: string | null;
    name?: string | null;
  }) =>
    computeJson<Vorgang>("/api/dokumente/vorgang", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eingabe),
    }),

  weiter: (id: string, ziel: Stand) =>
    computeJson<Vorgang>(`/api/dokumente/${id}/weiter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ziel }),
    }),

  urteil: (id: string, vollstaendig: boolean, kommentar: string | null) =>
    computeJson<Vorgang>(`/api/dokumente/${id}/urteil`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vollstaendig, kommentar }),
    }),

  scan: async (id: string, datei: File): Promise<Vorgang> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<Vorgang>(`/api/dokumente/${id}/scan`, { method: "POST", body: rumpf });
  },

  nachweisHoch: async (id: string, datei: File, zeile?: string): Promise<void> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    if (zeile) rumpf.append("zeile", zeile);
    await computeJson(`/api/dokumente/${id}/nachweis`, { method: "POST", body: rumpf });
  },

  /**
   * Ein Blatt oder einen Scan ansehen.
   *
   * Kein `<a download>`: die Papiere werden angesehen und gedruckt, nicht
   * abgelegt.
   */
  oeffnen: async (id: string, was: "blatt.pdf" | "scan"): Promise<void> => {
    const antwort = await computeFetch(`/api/dokumente/${id}/${was}`);
    if (!antwort.ok) {
      throw new Error((await antwort.text()).slice(0, 200) || `HTTP ${antwort.status}`);
    }
    const url = URL.createObjectURL(await antwort.blob());
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
