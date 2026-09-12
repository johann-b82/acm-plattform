import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Wie alt sind die Daten unter einer Kennzahl.
 *
 * Die Dashboards rechnen auf hochgeladenen ERP-Auszügen. Steht der letzte
 * Auszug seit drei Wochen, steht die Zahl seit drei Wochen — das gehört an
 * die Zahl und nicht in den Kopf derer, die sie vorträgt.
 *
 * Das Altsystem zeigte **einen** Stand für alles, in der Kopfzeile. Der war
 * für die meisten Seiten falsch: ein neuer Umsatzauszug macht die
 * Qualitätszahlen nicht frischer. Hier nennt jedes Dashboard die Dateien, auf
 * denen es steht.
 */

export interface Standzeile {
  art: string;
  zuletzt: string;
  laeufe: number;
}

/**
 * Welche Dateiart welches Dashboard trägt. Abgelesen an den SQL-Funktionen:
 * welche Tabelle sie lesen, und welcher Upload diese Tabelle füllt.
 * `auftrag_verzug` und `artikel_preise` sind Sichten — dort steht die Art
 * der Tabelle darunter.
 */
export const QUELLEN: Record<string, string[]> = {
  vertrieb: ["umsatz", "auftraege", "angebote", "interessenten", "kontakte"],
  einkauf: ["liefertreue", "lagerbewegungen", "lagerpreise"],
  produktion: ["auftragspositionen", "lieferscheine"],
  qualitaet: ["pruefungen", "acht_d", "lieferscheine", "wareneingaenge"],
  finanzen: ["umsatz", "lagerbewegungen", "materialpreise"],
};

export interface Stand {
  art: string;
  label: string;
  /** ISO-Zeitpunkt des letzten geglückten Uploads, `null` wenn nie einer kam. */
  zuletzt: string | null;
}

/**
 * Der Stand je Quelle eines Bereichs, älteste zuerst — denn so alt ist die
 * Seite. Eine Art, die nie kam, steht ganz oben: nichts ist älter als nie.
 */
export function staende(
  bereich: string,
  zeilen: Standzeile[] | undefined,
  label: Record<string, string> = {},
): Stand[] {
  const nach = new Map((zeilen ?? []).map((z) => [z.art, z.zuletzt]));
  return (QUELLEN[bereich] ?? [])
    .map((art) => ({
      art,
      label: label[art] ?? art,
      zuletzt: nach.get(art) ?? null,
    }))
    .sort((a, b) => {
      if (a.zuletzt === b.zuletzt) return a.label.localeCompare(b.label, "de");
      if (a.zuletzt === null) return -1;
      if (b.zuletzt === null) return 1;
      return a.zuletzt.localeCompare(b.zuletzt);
    });
}

/** Der Stand, der die Seite bestimmt: der älteste. `null`, wenn einer fehlt. */
export function aeltester(staende: Stand[]): string | null {
  if (staende.length === 0) return null;
  return staende[0].zuletzt;
}

const TAG = 24 * 60 * 60 * 1000;

/**
 * Wie viele Kalendertage her — nicht 24-Stunden-Schritte: ein Upload von
 * gestern Abend ist gestern, auch wenn er zehn Stunden her ist. Ein Zeitpunkt
 * in der Zukunft ist 0 und nicht „vor -1 Tagen".
 *
 * Wie daraus ein Satz wird, steht im Wörterbuch — „vor 5 Tagen" und
 * „5 days ago" bauen ihre Zahl verschieden ein.
 */
export function alterInTagen(zeitpunkt: string, jetzt: Date = new Date()): number {
  const dann = new Date(zeitpunkt);
  return Math.max(0, Math.round((mitternacht(jetzt) - mitternacht(dann)) / TAG));
}

function mitternacht(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export const datenstandKeys = {
  alle: () => ["datenstand"] as const,
};

export async function datenstand(): Promise<Standzeile[]> {
  const { data, error } = await supabaseBrowser()
    .from("datenstand")
    .select("art,zuletzt,laeufe");
  if (error) throw new Error(error.message);
  return (data ?? []) as Standzeile[];
}
