import { supabaseBrowser } from "@/lib/supabase/client";

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

export type FeedbackStatus = "neu" | "erledigt";

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
}

export interface Meldung {
  seite: string;
  beschreibung: string;
  browser?: string | null;
  ansicht?: string | null;
  bild?: Blob | null;
}

export const feedbackKeys = {
  liste: () => ["feedback", "liste"] as const,
  offen: () => ["feedback", "offen"] as const,
  bild: (pfad: string) => ["feedback", "bild", pfad] as const,
};

function pruefeBetroffen(daten: unknown[] | null): void {
  if (!daten?.length) {
    throw new Error("Nicht gespeichert — fehlt das Recht der Plattform-Verwaltung?");
  }
}

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

  liste: async (): Promise<Feedback[]> => {
    const { data, error } = await supabaseBrowser()
      .from("feedback")
      .select(
        "id,seite,beschreibung,bild_pfad,browser,ansicht,status,gesehen_am,erstellt_am,melder_email",
      )
      .order("erstellt_am", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Feedback[];
  },

  /** Kurzlebige URL auf ein Bild im nicht-öffentlichen Eimer. */
  bildUrl: async (pfad: string): Promise<string> => {
    const { data, error } = await supabaseBrowser()
      .storage.from(EIMER)
      .createSignedUrl(pfad, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  gesehen: async (id: string): Promise<void> => {
    const { error } = await supabaseBrowser()
      .from("feedback")
      .update({ gesehen_am: new Date().toISOString() })
      .eq("id", id)
      .is("gesehen_am", null);
    // Kein `pruefeBetroffen`: war die Meldung schon gesehen, ändert sich
    // nichts, und das ist kein Fehler.
    if (error) throw new Error(error.message);
  },

  status: async (id: string, status: FeedbackStatus): Promise<void> => {
    const { data, error } = await supabaseBrowser()
      .from("feedback")
      .update({ status })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },

  /** Löscht Bericht und Bild. Das Bild zuerst: bleibt die Zeile stehen,
   *  weil der Speicher klemmt, ist nichts verloren — umgekehrt bliebe ein
   *  Bild ohne Zeile im Eimer liegen, das niemand mehr findet. */
  loeschen: async (id: string, bildPfad: string | null): Promise<void> => {
    const sb = supabaseBrowser();
    if (bildPfad) {
      const { error } = await sb.storage.from(EIMER).remove([bildPfad]);
      if (error) throw new Error(error.message);
    }
    const { data, error } = await sb.from("feedback").delete().eq("id", id).select("id");
    if (error) throw new Error(error.message);
    pruefeBetroffen(data);
  },
};
