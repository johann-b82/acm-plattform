import { supabaseBrowser } from "@/lib/supabase/client";
import { loescheVersioniert, pruefeVersion, speichereVersioniert } from "@/lib/versioniert";

/**
 * Seiten-Feedback: melden, was auf einer Seite nicht stimmt.
 *
 * Reines Lesen und Schreiben über PostgREST, das Bild über Supabase Storage —
 * `compute` kommt hier nicht vor. Es ist der erste Verbraucher des Speichers
 * im neuen Stack.
 *
 * Der Eimer `feedback` ist nicht öffentlich. Hochladen darf jede angemeldete
 * Person, aber nur in den eigenen Ordner; gelesen wird über eine signierte,
 * kurzlebige URL, und das darf nur die Plattform-Verwaltung. Wer meldet,
 * bekommt seine Zeile nicht zurück — `insert ... returning` läuft durch die
 * Leseregel. Deshalb liefert `melden` nichts.
 */

export const EIMER = "feedback";

/** Passt zu `allowed_mime_types` des Eimers (Migration 0019). */
export const ERLAUBTE_BILDTYPEN = ["image/png", "image/jpeg", "image/webp"];
export const MAX_BILD_BYTES = 5 * 1024 * 1024;

/** In der Reihenfolge der Kanban-Spalten. */
export const FEEDBACK_STATUS = ["neu", "in_bearbeitung", "erledigt"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUS)[number];

export interface Feedback {
  id: string;
  seite: string;
  beschreibung: string;
  bild_pfad: string | null;
  browser: string | null;
  ansicht: string | null;
  status: FeedbackStatus;
  gesehen_am: string | null;
  erstellt_am: string;
  melder_email: string | null;
  /** Das Konto, das sich kümmert — `null`, solange niemand zugewiesen ist. */
  zugewiesen: string | null;
  /** Zählt die Datenbank bei jeder Änderung (ADR-0006). */
  version: number;
}

/** Wem eine Meldung zugewiesen werden kann: jedes Konto der Plattform. */
export interface Konto {
  id: string;
  email: string;
}

export interface Meldung {
  seite: string;
  beschreibung: string;
  browser?: string | null;
  ansicht?: string | null;
  bild?: Blob | null;
}

/** Die Kanban-Spalten nach Status. Ob eine Meldung gesehen ist, ist ein
 *  eigener Zustand und keine Spalte. */
export function nachStatus(meldungen: readonly Feedback[]): Record<FeedbackStatus, Feedback[]> {
  return {
    neu: meldungen.filter((m) => m.status === "neu"),
    in_bearbeitung: meldungen.filter((m) => m.status === "in_bearbeitung"),
    erledigt: meldungen.filter((m) => m.status === "erledigt"),
  };
}

/** Die Kanban-Spalten nach Person: vorn „nicht zugewiesen“, dann je Konto
 *  eine Spalte, nach E-Mail sortiert. Eine Meldung, deren Konto nicht mehr in
 *  der Liste steht, landet vorn — verloren geht keine. */
export function nachPerson(
  meldungen: readonly Feedback[],
  konten: readonly Konto[],
): { zugewiesen: string | null; meldungen: Feedback[] }[] {
  const sortiert = [...konten].sort((a, b) => a.email.localeCompare(b.email));
  const bekannt = new Set(sortiert.map((k) => k.id));
  return [
    { zugewiesen: null, meldungen: meldungen.filter((m) => m.zugewiesen === null || !bekannt.has(m.zugewiesen)) },
    ...sortiert.map((k) => ({ zugewiesen: k.id, meldungen: meldungen.filter((m) => m.zugewiesen === k.id) })),
  ];
}

/** Gehört eine Meldung zu dieser Seite? Gemeldet wird Pfad samt Suchteil;
 *  zugeordnet wird nach dem Pfad allein, Unterseiten zählen nicht mit. */
export function gehoertZurSeite(seite: string, pfad: string): boolean {
  return seite === pfad || seite.startsWith(`${pfad}?`);
}

export const feedbackKeys = {
  liste: () => ["feedback", "liste"] as const,
  seite: (pfad: string) => ["feedback", "seite", pfad] as const,
  offen: () => ["feedback", "offen"] as const,
  bild: (pfad: string) => ["feedback", "bild", pfad] as const,
  konten: () => ["feedback", "konten"] as const,
};

/** Objektname im Eimer: erster Abschnitt ist die eigene Kennung, sonst weist
 *  die Regel auf `storage.objects` den Upload ab. */
function bildPfad(kennung: string, typ: string): string {
  const endung = typ === "image/png" ? "png" : typ === "image/webp" ? "webp" : "jpg";
  return `${kennung}/${crypto.randomUUID()}.${endung}`;
}

export const feedbackApi = {
  /** Meldet. Gibt zurück, ob das Bild mitging.
   *
   *  Das Bild ist freiwillig: misslingt die Aufnahme oder ist sie größer als
   *  der Eimer zulässt (eine sehr lange Seite kommt dort hin), geht der
   *  Bericht ohne. Ein Bericht ohne Bild ist besser als keiner — daran darf
   *  die Meldung nicht scheitern. */
  melden: async (meldung: Meldung): Promise<{ mitBild: boolean }> => {
    const sb = supabaseBrowser();
    let pfad: string | null = null;

    if (meldung.bild && meldung.bild.size > 0 && meldung.bild.size <= MAX_BILD_BYTES) {
      const { data: sitzung } = await sb.auth.getUser();
      const kennung = sitzung.user?.id;
      if (!kennung) throw new Error("Keine Sitzung.");
      const ziel = bildPfad(kennung, meldung.bild.type);
      const { error } = await sb.storage
        .from(EIMER)
        .upload(ziel, meldung.bild, { contentType: meldung.bild.type });
      if (error) throw new Error(error.message);
      pfad = ziel;
    }

    const { error: fehler } = await sb.from("feedback").insert({
      seite: meldung.seite.slice(0, 500),
      beschreibung: meldung.beschreibung,
      bild_pfad: pfad,
      browser: meldung.browser || null,
      ansicht: meldung.ansicht || null,
    });
    if (fehler) throw new Error(fehler.message);
    return { mitBild: pfad !== null };
  },

  /** Wie viele Meldungen noch niemand angesehen hat.
   *
   *  Zählt in der Datenbank, statt die Liste zu holen und im Browser zu
   *  filtern: die Kopfzeile fragt das auf jeder Seite und im Takt, und die
   *  Berichte tragen Text und Bildpfade mit sich. Wer das Recht nicht hat,
   *  bekommt von der Leseregel 0 — das ist die richtige Antwort. */
  ungeseheneAnzahl: async (): Promise<number> => {
    const { count, error } = await supabaseBrowser()
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .is("gesehen_am", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  liste: async (): Promise<Feedback[]> => {
    const { data, error } = await supabaseBrowser()
      .from("feedback")
      .select(
        "id,seite,beschreibung,bild_pfad,browser,ansicht,status,gesehen_am,erstellt_am,melder_email,zugewiesen,version",
      )
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Feedback[];
  },

  /** Die nicht erledigten Meldungen zu einer Seite, neueste zuerst. `like`
   *  grenzt in der Datenbank ein; ob der Rest wirklich dieser Pfad ist (und
   *  nicht eine Unterseite oder ein `_` als Platzhalter), prüft
   *  `gehoertZurSeite`. */
  zurSeite: async (pfad: string): Promise<Feedback[]> => {
    const { data, error } = await supabaseBrowser()
      .from("feedback")
      .select(
        "id,seite,beschreibung,bild_pfad,browser,ansicht,status,gesehen_am,erstellt_am,melder_email,zugewiesen,version",
      )
      .like("seite", `${pfad}%`)
      .in("status", ["neu", "in_bearbeitung"])
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Feedback[]).filter((m) => gehoertZurSeite(m.seite, pfad));
  },

  /** Kurzlebige URL auf ein Bild im nicht-öffentlichen Eimer. */
  bildUrl: async (pfad: string): Promise<string> => {
    const { data, error } = await supabaseBrowser()
      .storage.from(EIMER)
      .createSignedUrl(pfad, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  /** Hakt ab, dass diese Meldungen auf dem Bildschirm standen.
   *
   *  Angesehen heißt: die Liste hat sie gezeigt. Früher zählte nur, wer das
   *  Bildschirmfoto öffnete — eine Meldung ohne Bild blieb damit für immer
   *  ungesehen, und die Zahl an der Glocke ginge nie wieder herunter. */
  gesehen: async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    const { error } = await supabaseBrowser()
      .from("feedback")
      .update({ gesehen_am: new Date().toISOString() })
      .in("id", ids)
      .is("gesehen_am", null);
    // Kein `pruefeBetroffen`: war die Meldung schon gesehen, ändert sich
    // nichts, und das ist kein Fehler.
    if (error) throw new Error(error.message);
  },

  // Status, Zuweisung und Löschen nur mit der geladenen Version (ADR-0006):
  // ziehen zwei die Karte gleichzeitig, gewinnt nicht still der Letzte.
  // „Gesehen" dagegen ohne — das hakt ab, was angezeigt wurde, und darf nie
  // an einer Version scheitern.
  status: async (m: Pick<Feedback, "id" | "version">, status: FeedbackStatus): Promise<void> => {
    await speichereVersioniert("feedback", m.id, m.version, { status });
  },

  zuweisen: async (m: Pick<Feedback, "id" | "version">, zugewiesen: string | null): Promise<void> => {
    await speichereVersioniert("feedback", m.id, m.version, { zugewiesen });
  },

  /** Die Konten, denen zugewiesen werden kann — dieselbe Sicht wie die
   *  Zugänge in den Einstellungen, lesbar nur für die Plattform-Verwaltung. */
  konten: async (): Promise<Konto[]> => {
    const { data, error } = await supabaseBrowser()
      .from("plattform_nutzer")
      .select("id,email")
      .order("email");
    if (error) throw new Error(error.message);
    return (data ?? []) as Konto[];
  },

  /** Löscht Bericht und Bild. Das Bild zuerst: bleibt die Zeile stehen,
   *  weil der Speicher klemmt, ist nichts verloren — umgekehrt bliebe ein
   *  Bild ohne Zeile im Eimer liegen, das niemand mehr findet. Davor die
   *  Version: hat jemand die Meldung inzwischen geändert, bleibt beides. */
  loeschen: async (m: Pick<Feedback, "id" | "version" | "bild_pfad">): Promise<void> => {
    if (m.bild_pfad) {
      await pruefeVersion("feedback", m.id, m.version);
      const { error } = await supabaseBrowser().storage.from(EIMER).remove([m.bild_pfad]);
      if (error) throw new Error(error.message);
    }
    await loescheVersioniert("feedback", m.id, m.version);
  },
};
