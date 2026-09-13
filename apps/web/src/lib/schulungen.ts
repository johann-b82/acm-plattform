import { supabaseBrowser } from "@/lib/supabase/client";
import { computeJson } from "@/lib/compute";

/**
 * Schulungen: Katalog, Anforderungsmatrix, Teilnahmen.
 *
 * Gelesen und gepflegt über PostgREST. Nur das Einlesen der
 * Schulungsübersicht läuft über `compute` — eine transponierte Excel mit drei
 * Zeilen je Schulung und Namensabgleich gegen ein Personio-Freifeld.
 *
 * Die Fälligkeit steht nirgends gespeichert: die Sicht `schulung_stand`
 * rechnet sie aus letztem Termin und Turnus. Ändert jemand den Turnus, stimmt
 * sie sofort — im Altprojekt bliebe die gespeicherte Spalte stehen.
 */

export interface Schulung {
  id: string;
  bereich: string;
  name: string;
  turnus: string | null;
  turnus_monate: number | null;
  frist_tage: number | null;
  verantwortlicher: string | null;
  beschreibung: string | null;
  sortierung: number;
  aktiv: boolean;
}

export interface Pflicht {
  id: string;
  schulung_id: string;
  ebene: "kuerzel" | "personio";
  abteilung: string;
}

export interface Teilnahme {
  id: string;
  schulung_id: string;
  employee_id: number | null;
  extern_id: string | null;
  personalnummer: string | null;
  mitarbeiter_name: string | null;
  abteilung_kuerzel: string | null;
  initial_datum: string | null;
  aktuell_datum: string | null;
  naechste_faellig: string | null;
}

export interface Stand {
  teilnahme_id: string;
  schulung_id: string;
  employee_id: number | null;
  extern_id: string | null;
  /** `e:<id>`, `x:<uuid>` oder `p:<personalnummer>` — passt zu `Person.schluessel`. */
  schluessel: string;
  mitarbeiter_name: string | null;
  abteilung_kuerzel: string | null;
  bereich: string;
  schulung: string;
  turnus_monate: number | null;
  aktuell_datum: string | null;
  faellig_am: string | null;
  ueberfaellig: boolean;
  nie_absolviert: boolean;
}

/** Eine Zeile der Matrix: wer überhaupt geschult werden muss. */
export interface Person {
  schluessel: string;
  employee_id: number | null;
  extern_id: string | null;
  personalnummer: string | null;
  name: string | null;
  abteilung: string | null;
  eintritt: string | null;
  herkunft: "personio" | "extern" | "ohne_zuordnung";
  /** Personio-Standort; bei extern Gepflegten und Resten leer. */
  standort: string | null;
}

export const HERKUNFT_LABEL: Record<Person["herkunft"], string> = {
  personio: "Personio",
  extern: "extern gepflegt",
  ohne_zuordnung: "ohne Personio-Treffer",
};

export interface OhneZuordnung {
  personalnummer: string;
  mitarbeiter_name: string | null;
  teilnahmen: number;
}

export interface ImportErgebnis {
  dateiname: string;
  schulungen: number;
  schulungen_neu: number;
  teilnahmen: number;
  teilnahmen_zugeordnet: number;
  bereiche: Record<string, number>;
  nicht_zugeordnet: OhneZuordnung[];
  hinweise: string[];
}

const SCHULUNG_FELDER =
  "id,bereich,name,turnus,turnus_monate,frist_tage,verantwortlicher," +
  "beschreibung,sortierung,aktiv";

export const schulungKeys = {
  katalog: () => ["schulungen", "katalog"] as const,
  pflicht: () => ["schulungen", "pflicht"] as const,
  teilnahmen: (id: string) => ["schulungen", "teilnahmen", id] as const,
  stand: () => ["schulungen", "stand"] as const,
  belegschaft: () => ["schulungen", "belegschaft"] as const,
};

function sb() {
  return supabaseBrowser();
}

/**
 * Wie dringend ist es? Nie absolviert wiegt schwerer als überfällig: das eine
 * ist eine Lücke, das andere eine Verspätung.
 */
export type Dringlichkeit = "offen" | "ueberfaellig" | "nie" | "faellig_bald";

export function dringlichkeit(stand: Stand, heute = new Date()): Dringlichkeit {
  if (stand.nie_absolviert) return "nie";
  if (stand.ueberfaellig) return "ueberfaellig";
  if (stand.faellig_am) {
    const tage = (new Date(stand.faellig_am).getTime() - heute.getTime()) / 86_400_000;
    if (tage <= 60) return "faellig_bald";
  }
  return "offen";
}

export const DRINGLICHKEIT_LABEL: Record<Dringlichkeit, string> = {
  nie: "nie absolviert",
  ueberfaellig: "überfällig",
  faellig_bald: "wird fällig",
  offen: "im Turnus",
};

// --- Stand der Mitarbeiter ---------------------------------------------------
//
// Dieselbe Abgrenzung wie im Altsystem (`routers/schulungen.py`: `/offen`,
// `/mitarbeiter`). Am Bestand nachgerechnet: so ergeben sich die 65 offenen
// Schulungen (60 überfällig, 5 bald) der Referenz. Die frühere Liste zählte
// dagegen jede nie absolvierte Teilnahme und auch Ausgetretene mit — 274.

/** Ab wann eine Fälligkeit „bald“ ist: drei Monate, wie im Altsystem. */
export const BALD_TAGE = 90;

/** Ein Kalendertag als `JJJJ-MM-TT`, nach der Uhr des Browsers. */
export function tagesdatum(d: Date): string {
  const monat = String(d.getMonth() + 1).padStart(2, "0");
  const tag = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${monat}-${tag}`;
}

function alsUtc(tag: string): number {
  const [jahr, monat, t] = tag.slice(0, 10).split("-").map(Number);
  return Date.UTC(jahr, monat - 1, t);
}

function plusTage(tag: string, tage: number): string {
  return new Date(alsUtc(tag) + tage * 86_400_000).toISOString().slice(0, 10);
}

function tageZwischen(von: string, bis: string): number {
  return Math.round((alsUtc(bis) - alsUtc(von)) / 86_400_000);
}

/**
 * Wann eine Teilnahme fällig ist.
 *
 * Absolviert: letzter Termin plus Turnus (rechnet die Sicht). Noch nie
 * absolviert: Eintritt plus Frist der Schulung — so wird eine neu zugewiesene
 * Pflichtschulung fristgerecht fällig, statt ohne Termin zu bleiben.
 */
export function effektiveFaelligkeit(
  stand: Stand,
  fristTage: number | null,
  eintritt: string | null,
): string | null {
  if (stand.faellig_am) return stand.faellig_am.slice(0, 10);
  if (stand.aktuell_datum === null && fristTage !== null && eintritt) {
    return plusTage(eintritt, fristTage);
  }
  return null;
}

export type Faelligkeit = "ueberfaellig" | "bald" | "ok" | "ohne_frist";

export function faelligkeitsstatus(faellig: string | null, heute: string): Faelligkeit {
  if (faellig === null) return "ohne_frist";
  const tage = tageZwischen(heute, faellig);
  if (tage < 0) return "ueberfaellig";
  return tage <= BALD_TAGE ? "bald" : "ok";
}

/**
 * Wer im Stand der Mitarbeiter zählt: Personio (aktiv oder im Eintritt) und
 * extern Gepflegte. Die Reste der Excel-Historie ohne Personio-Treffer stehen
 * in der Gesamtmatrix, hier nicht — wie im Altsystem.
 */
export function standBelegschaft(personen: readonly Person[]): Person[] {
  return personen.filter((p) => p.herkunft !== "ohne_zuordnung");
}

/** Leere Auswahl heißt: alle Standorte. */
export function imStandort(person: Person, gewaehlt: ReadonlySet<string>): boolean {
  return gewaehlt.size === 0 || (person.standort !== null && gewaehlt.has(person.standort));
}

/** Die Standorte, die in den Daten vorkommen. */
export function standorte(personen: readonly Person[]): string[] {
  return [
    ...new Set(personen.map((p) => p.standort).filter((s): s is string => !!s)),
  ].sort((a, b) => a.localeCompare(b, "de"));
}

export interface FaelligeZeile {
  stand: Stand;
  person: Person;
  faellig: string;
  /** Negativ: überfällig seit so vielen Tagen. */
  tage: number;
  status: "ueberfaellig" | "bald";
}

function verbunden(stand: readonly Stand[], personen: readonly Person[], katalog: readonly Schulung[]) {
  const nachPerson = new Map(standBelegschaft(personen).map((p) => [p.schluessel, p]));
  const nachSchulung = new Map(katalog.map((s) => [s.id, s]));
  return stand.flatMap((s) => {
    const person = nachPerson.get(s.schluessel);
    const schulung = nachSchulung.get(s.schulung_id);
    // Stillgelegte Schulungen zählen nirgends mehr als offen.
    return person && schulung?.aktiv ? [{ stand: s, person, schulung }] : [];
  });
}

/** Was überfällig ist oder in den nächsten drei Monaten fällig wird. */
export function faelligeSchulungen(
  stand: readonly Stand[],
  personen: readonly Person[],
  katalog: readonly Schulung[],
  heute: string,
): FaelligeZeile[] {
  const grenze = plusTage(heute, BALD_TAGE);
  const zeilen: FaelligeZeile[] = [];
  for (const { stand: s, person, schulung } of verbunden(stand, personen, katalog)) {
    const faellig = effektiveFaelligkeit(s, schulung.frist_tage, person.eintritt);
    if (faellig === null || faellig > grenze) continue;
    zeilen.push({
      stand: s,
      person,
      faellig,
      tage: tageZwischen(heute, faellig),
      status: faellig < heute ? "ueberfaellig" : "bald",
    });
  }
  return zeilen.sort(
    (a, b) => a.faellig.localeCompare(b.faellig) || (a.person.name ?? "").localeCompare(b.person.name ?? ""),
  );
}

/**
 * Nie absolviert und ohne berechenbaren Termin — kein Turnus, keine Frist.
 * Das Altsystem zeigt diese Zeilen in der Liste gar nicht; hier bleiben sie
 * als eigene Auswahl sichtbar, zählen aber nicht zu den fälligen.
 */
export function ohneTermin(
  stand: readonly Stand[],
  personen: readonly Person[],
  katalog: readonly Schulung[],
): { stand: Stand; person: Person }[] {
  return verbunden(stand, personen, katalog)
    .filter(
      ({ stand: s, person, schulung }) =>
        s.nie_absolviert && effektiveFaelligkeit(s, schulung.frist_tage, person.eintritt) === null,
    )
    .map(({ stand: s, person }) => ({ stand: s, person }));
}

export interface Mitarbeiterstand {
  person: Person;
  schulungen: number;
  ueberfaellig: number;
  bald: number;
  naechste: string | null;
}

/** Je Person: wie viele Schulungen, wie viele überfällig oder bald fällig. */
export function mitarbeiterstand(
  stand: readonly Stand[],
  personen: readonly Person[],
  katalog: readonly Schulung[],
  heute: string,
): Mitarbeiterstand[] {
  const nach = new Map<string, Mitarbeiterstand>(
    standBelegschaft(personen).map((p) => [
      p.schluessel,
      { person: p, schulungen: 0, ueberfaellig: 0, bald: 0, naechste: null },
    ]),
  );
  for (const { stand: s, person, schulung } of verbunden(stand, personen, katalog)) {
    const eintrag = nach.get(person.schluessel)!;
    const faellig = effektiveFaelligkeit(s, schulung.frist_tage, person.eintritt);
    const status = faelligkeitsstatus(faellig, heute);
    eintrag.schulungen += 1;
    if (status === "ueberfaellig") eintrag.ueberfaellig += 1;
    if (status === "bald") eintrag.bald += 1;
    if (faellig !== null && (eintrag.naechste === null || faellig < eintrag.naechste)) {
      eintrag.naechste = faellig;
    }
  }
  return [...nach.values()].sort(
    (a, b) =>
      b.ueberfaellig - a.ueberfaellig ||
      b.bald - a.bald ||
      (a.person.name ?? "").localeCompare(b.person.name ?? ""),
  );
}

/** Eine Person aus dem Organigramm — aktiv, mit Vorgesetztem. */
export interface OrganigrammPerson {
  id: number;
  name: string | null;
  department: string | null;
  vorgesetzter_id: number | null;
}

export interface AbteilungMitFuehrung {
  abteilung: string;
  mitarbeiter: number;
  /** Nach Häufigkeit: wer am öftesten als Vorgesetzter geführt wird, zuerst. */
  vorgesetzte: string[];
}

/**
 * Abteilungen der aktiven Belegschaft mit ihren Vorgesetzten (SCH-06).
 *
 * Wie im Altsystem aus Personio abgeleitet: je Abteilung zählt, wer von wie
 * vielen Mitarbeitern als Vorgesetzter geführt wird. Nur aktive Vorgesetzte
 * zählen; wer keinen hat, bleibt leer — zugewiesen wird niemand.
 */
export function abteilungenMitVorgesetzten(
  personen: readonly OrganigrammPerson[],
): AbteilungMitFuehrung[] {
  const namen = new Map(personen.map((p) => [p.id, p.name ?? `#${p.id}`]));
  const kopfzahl = new Map<string, number>();
  const fuehrung = new Map<string, Map<number, number>>();
  for (const p of personen) {
    const abteilung = (p.department ?? "").trim();
    if (!abteilung) continue;
    kopfzahl.set(abteilung, (kopfzahl.get(abteilung) ?? 0) + 1);
    if (p.vorgesetzter_id !== null && namen.has(p.vorgesetzter_id)) {
      const je = fuehrung.get(abteilung) ?? new Map<number, number>();
      je.set(p.vorgesetzter_id, (je.get(p.vorgesetzter_id) ?? 0) + 1);
      fuehrung.set(abteilung, je);
    }
  }
  return [...kopfzahl.entries()]
    .map(([abteilung, mitarbeiter]) => ({
      abteilung,
      mitarbeiter,
      vorgesetzte: [...(fuehrung.get(abteilung) ?? new Map<number, number>()).entries()]
        .sort((a, b) => b[1] - a[1] || namen.get(a[0])!.localeCompare(namen.get(b[0])!))
        .map(([id]) => namen.get(id)!),
    }))
    .sort((a, b) => b.mitarbeiter - a.mitarbeiter || a.abteilung.localeCompare(b.abteilung));
}

/**
 * Eine Abfrage vollständig laden. PostgREST liefert höchstens 1000 Zeilen je
 * Abruf und schneidet still ab — deshalb seitenweise, bis eine Seite kürzer
 * ist als voll.
 */
async function vollstaendig<T>(
  abfrage: (von: number, bis: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const SEITE = 1000;
  const alle: T[] = [];
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await abfrage(von, von + SEITE - 1);
    if (error) throw new Error(error.message);
    const zeilen = (data ?? []) as T[];
    alle.push(...zeilen);
    if (zeilen.length < SEITE) return alle;
  }
}

export const schulungApi = {
  katalog: async (): Promise<Schulung[]> => {
    const { data, error } = await sb()
      .from("schulung_katalog")
      .select(SCHULUNG_FELDER)
      .order("bereich")
      .order("sortierung");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Schulung[];
  },

  anlegen: async (bereich: string, name: string): Promise<void> => {
    const { error } = await sb().from("schulung_katalog").insert({ bereich, name });
    if (error) throw new Error(error.message);
  },

  aendern: async (id: string, felder: Partial<Schulung>): Promise<void> => {
    const { data, error } = await sb()
      .from("schulung_katalog")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  loeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("schulung_katalog").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  pflicht: async (): Promise<Pflicht[]> => {
    const { data, error } = await sb()
      .from("schulung_pflicht")
      .select("id,schulung_id,ebene,abteilung")
      .order("abteilung");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Pflicht[];
  },

  pflichtSetzen: async (
    schulung_id: string,
    ebene: Pflicht["ebene"],
    abteilung: string,
    an: boolean,
  ): Promise<void> => {
    const client = sb();
    const { error } = an
      ? await client.from("schulung_pflicht").insert({ schulung_id, ebene, abteilung })
      : await client
          .from("schulung_pflicht")
          .delete()
          .eq("schulung_id", schulung_id)
          .eq("ebene", ebene)
          .eq("abteilung", abteilung);
    if (error) throw new Error(error.message);
  },

  teilnahmen: async (schulung_id: string): Promise<Teilnahme[]> => {
    const { data, error } = await sb()
      .from("schulung_teilnahmen")
      .select(
        "id,schulung_id,employee_id,extern_id,personalnummer,mitarbeiter_name," +
          "abteilung_kuerzel,initial_datum,aktuell_datum,naechste_faellig",
      )
      .eq("schulung_id", schulung_id)
      .order("mitarbeiter_name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Teilnahme[];
  },

  teilnahmeAendern: async (id: string, felder: Partial<Teilnahme>): Promise<void> => {
    const { data, error } = await sb()
      .from("schulung_teilnahmen")
      .update(felder)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Nicht gespeichert — fehlt das Recht?");
  },

  teilnahmeAnlegen: async (
    schulung_id: string,
    mitarbeiter_name: string,
    employee_id: number | null,
  ): Promise<void> => {
    const { error } = await sb()
      .from("schulung_teilnahmen")
      .insert({ schulung_id, mitarbeiter_name, employee_id });
    if (error) throw new Error(error.message);
  },

  teilnahmeLoeschen: async (id: string): Promise<void> => {
    const { error } = await sb().from("schulung_teilnahmen").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  stand: (): Promise<Stand[]> =>
    vollstaendig<Stand>((von, bis) =>
      sb().from("schulung_stand").select("*").order("teilnahme_id").range(von, bis),
    ),

  belegschaft: (): Promise<Person[]> =>
    vollstaendig<Person>((von, bis) =>
      sb()
        .from("schulung_belegschaft")
        .select("*")
        .order("name")
        .order("schluessel")
        .range(von, bis),
    ),

  /** Die aktive Belegschaft mit Vorgesetzten — für „Abteilungen & Vorgesetzte“. */
  organigramm: (): Promise<OrganigrammPerson[]> =>
    vollstaendig<OrganigrammPerson>((von, bis) =>
      sb().from("organigramm").select("id,name,department,vorgesetzter_id").order("id").range(von, bis),
    ),

  /**
   * Die Spalten der Anforderungsmatrix je Ebene, wie im Altsystem: die Kürzel
   * aus der Schulungshistorie beziehungsweise die Abteilungen der aktiven
   * Belegschaft — jeweils ergänzt um die, die schon eine Pflicht tragen.
   */
  pflichtAchse: async (ebene: Pflicht["ebene"], pflichten: readonly Pflicht[]): Promise<string[]> => {
    const werte =
      ebene === "kuerzel"
        ? (
            await vollstaendig<{ abteilung_kuerzel: string | null }>((von, bis) =>
              sb()
                .from("schulung_teilnahmen")
                .select("abteilung_kuerzel")
                .not("abteilung_kuerzel", "is", null)
                .order("id")
                .range(von, bis),
            )
          ).map((z) => z.abteilung_kuerzel)
        : (
            await vollstaendig<{ department: string | null }>((von, bis) =>
              sb().from("organigramm").select("department").order("id").range(von, bis),
            )
          ).map((z) => z.department);
    const gepflegt = pflichten.filter((p) => p.ebene === ebene).map((p) => p.abteilung);
    return [
      ...new Set([...werte, ...gepflegt].map((w) => (w ?? "").trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "de"));
  },

  /**
   * Eine Schulung einer Person zuweisen — die Zeile entsteht ohne Termin.
   * Gibt es sie schon, lehnt die Datenbank ab (eine Teilnahme je Person).
   */
  zuweisen: async (schulung_id: string, person: Person): Promise<void> => {
    const { error } = await sb().from("schulung_teilnahmen").insert({
      schulung_id,
      employee_id: person.employee_id,
      extern_id: person.extern_id,
      mitarbeiter_name: person.name,
    });
    if (error) throw new Error(error.message);
  },

  /** Eine Schulung für mehrere Personen zum selben Tag abschließen (SCH-05). */
  sammelabschluss: async (
    schulung_id: string,
    datum: string,
    personen: readonly string[],
  ): Promise<{ eingetragen: number; unveraendert: number }> => {
    const { data, error } = await sb().rpc("schulung_sammelabschluss", {
      p_schulung_id: schulung_id,
      p_datum: datum,
      p_personen: personen,
    });
    if (error) throw new Error(error.message);
    const zeile = (Array.isArray(data) ? data[0] : data) as
      | { eingetragen: number; unveraendert: number }
      | undefined;
    return zeile ?? { eingetragen: 0, unveraendert: 0 };
  },

  vorschau: async (datei: File): Promise<ImportErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<ImportErgebnis>("/api/schulungen/vorschau", {
      method: "POST",
      body: rumpf,
    });
  },

  uebernehmen: async (datei: File): Promise<ImportErgebnis> => {
    const rumpf = new FormData();
    rumpf.append("datei", datei);
    return computeJson<ImportErgebnis>("/api/schulungen/uebernehmen", {
      method: "POST",
      body: rumpf,
    });
  },
};
