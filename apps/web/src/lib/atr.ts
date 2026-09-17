import { supabaseBrowser } from "@/lib/supabase/client";
import { loescheVersioniert, speichereVersioniert } from "@/lib/versioniert";
import { computeFetch, computeJson } from "@/lib/compute";

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
  teile: () => ["atr", "teile"] as const,
  vorlagen: () => ["atr", "vorlagen"] as const,
};

/** PostgREST liefert höchstens so viele Zeilen je Anfrage. */
const SEITE = 1000;

/**
 * Holt eine Tabelle vollständig, Seite für Seite. Eine Liste, die still bei
 * 500 oder 1000 aufhört, sieht aus wie eine vollständige (TAB-01).
 * `abfrage(von, bis)` ist eine sortierte Abfrage mit `.range(von, bis)`.
 */
export async function ladeAlle<T>(
  abfrage: (
    von: number,
    bis: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const alle: T[] = [];
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await abfrage(von, von + SEITE - 1);
    if (error) throw new Error(error.message);
    alle.push(...(data ?? []));
    if (!data || data.length < SEITE) return alle;
  }
}

/** Wie im Altsystem (`formatPoPos`): bis drei Ziffern vorne mit Nullen. */
export function formatPoPos(wert: string | null | undefined): string {
  if (wert == null) return "";
  const text = wert.trim();
  return /^\d{1,3}$/.test(text) ? text.padStart(3, "0") : wert;
}

/** Das kommagetrennte Feld des Altsystems als Liste. */
export function seriennummernAusText(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Je geliefertem Stück eine Seriennummer — sonst warnt die Maske. */
export function seriennummernAbweichung(seriennummern: readonly string[], menge: number): boolean {
  return seriennummern.length !== menge;
}

/** Gewicht aus einem Eingabefeld: Komma oder Punkt, leer heißt keins. */
export function gewichtAusEingabe(text: string): { wert: string | null } | { fehler: true } {
  const roh = text.trim().replace(",", ".");
  if (!roh) return { wert: null };
  if (!/^\d+(\.\d+)?$/.test(roh)) return { fehler: true };
  return { wert: roh };
}

/** Scan-Intervall in ganzen Sekunden ab 0; alles andere ist ungültig. */
export function intervallAusEingabe(text: string): number | null {
  const roh = text.trim();
  return /^\d+$/.test(roh) ? Number(roh) : null;
}

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
  /** Der ganze Katalog. Gesucht wird in der Tabelle — über Teilenummer,
   *  Bezeichnung und Zeichnung, und eine Zifferneingabe trifft über die
   *  normierte Spalte auch eine anders geschriebene Nummer. */
  teile: async (): Promise<Teil[]> =>
    ladeAlle((von, bis) =>
      supabaseBrowser()
        .from("atr_teile")
        .select(TEIL_FELDER)
        .order("teilenummer")
        .order("id")
        .range(von, bis)
        .then((r: { data: unknown; error: { message: string } | null }) => ({
          data: r.data as Teil[] | null,
          error: r.error,
        })),
    ),

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

/** Die Zustände des Altsystems: draft, generated, delivered. */
export type LieferungStatus = "entwurf" | "erzeugt" | "abgelegt";

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
  /** Zählt die Datenbank bei jeder Änderung (ADR-0006). */
  version: number;
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
  version: number;
}

export interface ErzeugtErgebnis {
  mappe_pfad: string;
  pdf_pfad: string | null;
  etikett_pfad: string;
  pdf_hinweis: string | null;
}

export interface AbgelegtesZiel {
  bezeichnung: string;
  pfad: string;
  dateiname: string;
}

export interface GescheitertesZiel {
  bezeichnung: string;
  fehler: string;
}

/** Je Ziel ein Ergebnis — eine Ablage kann teilweise gelingen. */
export interface AblageErgebnis {
  abgelegt: AbgelegtesZiel[];
  gescheitert: GescheitertesZiel[];
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
  "mappe_pfad,pdf_pfad,etikett_pfad,erzeugt_am,geaendert_am,erstellt_am,version";

const POSITION_FELDER =
  "id,lieferung_id,reihenfolge,pos,lieferantennummer,teilenummer,teilenummer_norm," +
  "teil_id,bezeichnung,zeichnung,kategorie,menge,gewicht_kg,bestellposition,seriennummern,version";

export const lieferungKeys = {
  naechsteNummer: (programm: string | null) => ["atr", "naechste-nummer", programm] as const,
  liste: () => ["atr", "lieferungen"] as const,
  eine: (id: string) => ["atr", "lieferung", id] as const,
  positionen: (id: string) => ["atr", "positionen", id] as const,
};

export const lieferungApi = {
  /** Vorschlag für die laufende ATR-Nummer: höchste dieser Programmfamilie
   *  plus eins. `null` heißt, dass die erste von Hand zu setzen ist. */
  naechsteNummer: async (programm: string | null): Promise<string | null> =>
    (
      await computeJson<{ nummer: string | null }>(
        `/api/atr/naechste-nummer${programm ? `?programm=${encodeURIComponent(programm)}` : ""}`,
      )
    ).nummer,

  liste: async (): Promise<Lieferung[]> =>
    ladeAlle((von, bis) =>
      supabaseBrowser()
        .from("atr_lieferungen")
        .select(LIEFERUNG_FELDER)
        .order("erstellt_am", { ascending: false })
        .order("id")
        .range(von, bis)
        .then((r: { data: unknown; error: { message: string } | null }) => ({
          data: r.data as Lieferung[] | null,
          error: r.error,
        })),
    ),

  /**
   * Weist den Lieferungen die Containernummer zu und lädt das Etikett des
   * Containers herunter — über `compute`, weil dort das Word-Dokument entsteht
   * und Zuweisen und Lesen in einem Schreibvorgang geschehen.
   */
  containerEtikett: async (containernummer: string, lieferungen: string[]): Promise<void> => {
    const antwort = await computeFetch("/api/atr/container-etikett", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ containernummer, lieferungen }),
    });
    if (!antwort.ok) {
      const body = await antwort.json().catch(() => null);
      throw new Error(body?.detail ? String(body.detail) : `HTTP ${antwort.status}`);
    }
    const url = URL.createObjectURL(await antwort.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `Container_${containernummer}.docx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

  // Gespeichert und gelöscht wird nur mit der geladenen Version (ADR-0006).
  aendern: async (l: Pick<Lieferung, "id" | "version">, felder: Partial<Lieferung>): Promise<void> => {
    await speichereVersioniert("atr_lieferungen", l.id, l.version, felder);
  },

  /** Gibt die neue Version zurück — die nächste Änderung derselben Position
   *  braucht sie, bevor die Liste neu geladen ist. */
  positionAendern: async (
    p: Pick<AtrPosition, "id" | "version">,
    felder: Partial<AtrPosition>,
  ): Promise<number> => speichereVersioniert("atr_positionen", p.id, p.version, felder),

  positionLoeschen: async (p: Pick<AtrPosition, "id" | "version">): Promise<void> => {
    await loescheVersioniert("atr_positionen", p.id, p.version);
  },

  loeschen: async (l: Pick<Lieferung, "id" | "version">): Promise<void> => {
    await loescheVersioniert("atr_lieferungen", l.id, l.version);
  },

  /** Erzeugt Mappe, PDF und Etikett — über `compute`, weil dort openpyxl und
   *  LibreOffice sitzen. */
  erzeugen: async (id: string): Promise<ErzeugtErgebnis> =>
    computeJson<ErzeugtErgebnis>(`/api/atr/lieferungen/${id}/erzeugen`, {
      method: "POST",
    }),

  /** Legt Mappe und PDF in den festen Ordnern auf dem Dateiserver ab. Die
   *  Antwort nennt jedes Ziel einzeln — eine Ablage kann teilweise gelingen. */
  ablegen: async (id: string): Promise<AblageErgebnis> =>
    computeJson<AblageErgebnis>(`/api/atr/lieferungen/${id}/ablegen`, {
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

export interface ScanEinstellung {
  /** Sekunden zwischen zwei Läufen, 0 = aus. */
  intervall_s: number;
  modus: "entwurf" | "automatisch";
  rechner: string | null;
  freigabe: string | null;
  domaene: string | null;
  benutzer: string | null;
  eingang: string | null;
  ausgang: string | null;
  archiv: string | null;
  /** Ablageziele von „Auf Server speichern“ — Ordner unter der Freigabe,
   *  `{jahr}` und `{kw}` werden beim Ablegen eingesetzt. Nie leer. */
  ziel_mappe_a350: string;
  ziel_mappe_a380: string;
  ziel_logistik: string;
  ziel_weight_report: string;
  zuletzt_am: string | null;
  zuletzt_text: string | null;
}

export interface ScanProbe {
  erreichbar: boolean;
  dateien: number | null;
  meldung: string | null;
}

export interface ScanLauf {
  gelesen: number;
  angelegt: number;
  erzeugt: number;
  liegen_geblieben: string[];
  hinweise: string[];
}

/** Was die Maske über das Passwort erfährt — nie das Passwort selbst. */
export interface PasswortStand {
  gesetzt: boolean;
  quelle: "datenbank" | "umgebung" | null;
  geaendert_am: string | null;
  schluessel_bereit: boolean;
}

const SCAN_FELDER =
  "intervall_s,modus,rechner,freigabe,domaene,benutzer,eingang,ausgang,archiv," +
  "ziel_mappe_a350,ziel_mappe_a380,ziel_logistik,ziel_weight_report," +
  "zuletzt_am,zuletzt_text";

export const scanKeys = {
  einstellung: () => ["atr", "scan"] as const,
  passwort: () => ["atr", "scan", "passwort"] as const,
};

export const scanApi = {
  einstellung: async (): Promise<ScanEinstellung | null> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_scan")
      .select(SCAN_FELDER)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as ScanEinstellung) ?? null;
  },

  aendern: async (felder: Partial<ScanEinstellung>): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("atr_scan")
      .update(felder)
      .eq("id", true)
      .select("intervall_s");
    if (error) throw new Error(error.message);
    if (!data?.length) {
      throw new Error(
        "Nicht gespeichert — das ändert nur die Plattform-Verwaltung.",
      );
    }
  },

  /** Prüft die Verbindung, ohne etwas zu verändern. */
  probe: async (): Promise<ScanProbe> =>
    computeJson<ScanProbe>("/api/atr/scan/probe", { method: "POST" }),

  /** Sieht den Eingangsordner jetzt durch. */
  lauf: async (): Promise<ScanLauf> =>
    computeJson<ScanLauf>("/api/atr/scan", { method: "POST" }),

  /** Ob ein Passwort hinterlegt ist — nur die Plattform-Verwaltung. */
  passwortStand: async (): Promise<PasswortStand> =>
    computeJson<PasswortStand>("/api/atr/scan/passwort"),

  passwortSetzen: async (passwort: string): Promise<PasswortStand> =>
    computeJson<PasswortStand>("/api/atr/scan/passwort", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwort }),
    }),
};
