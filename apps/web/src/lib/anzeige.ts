/**
 * Die Anzeigen für die Bildschirme.
 *
 * Diese Datei ist die einzige im Web, die ohne Sitzung arbeitet: die Seiten
 * unter `/embed` laufen auf einer Tafel, die sich nicht anmeldet. Statt einer
 * Sitzung trägt jeder Aufruf den signierten Token aus der URL (siehe
 * `services/compute/app/embed.py`). Deshalb kein `computeFetch` — der hängte
 * ein Bearer-Token an, das es hier nicht gibt.
 *
 * Was zurückkommt, ist bewusst wenig: Name, Abteilung, Wochentag. **Kein
 * Geburtsdatum, kein Alter** — eine Tafel hängt im Flur.
 */

export type Anzeigenart = "geburtstage" | "neuzugaenge";

export interface Geburtstag {
  id: number;
  vorname: string | null;
  nachname: string | null;
  abteilung: string | null;
  /** 0 = Montag … 6 = Sonntag. */
  wochentag: number;
  hat_foto: boolean;
}

export interface Neuzugang {
  id: number;
  vorname: string | null;
  nachname: string | null;
  abteilung: string | null;
  eintritt: string;
  tage_dabei: number;
  hat_foto: boolean;
}

export interface NeuerToken {
  token: string;
  gueltig_bis: string;
}

export const WOCHENTAGE = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

async function hole<T>(pfad: string): Promise<T> {
  const antwort = await fetch(pfad);
  if (!antwort.ok) {
    const body = await antwort.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : `HTTP ${antwort.status}`;
    throw new Error(detail);
  }
  return (await antwort.json()) as T;
}

export const anzeigeApi = {
  geburtstage: (token: string) =>
    hole<Geburtstag[]>(`/api/anzeige/geburtstage?token=${encodeURIComponent(token)}`),

  neuzugaenge: (token: string, wochen = 12) =>
    hole<Neuzugang[]>(
      `/api/anzeige/neuzugaenge?token=${encodeURIComponent(token)}&wochen=${wochen}`,
    ),

  /** Der Bildweg. `<img>` kann keinen Kopf setzen, also reitet der Token mit. */
  fotoUrl: (id: number, token: string) =>
    `/api/anzeige/foto/${id}?token=${encodeURIComponent(token)}`,
};

export const anzeigeKeys = {
  alle: ["anzeige"] as const,
  liste: (art: Anzeigenart, token: string) => ["anzeige", art, token] as const,
};

/** Anfangsbuchstaben, wenn kein Bild da ist. */
export function initialen(vorname: string | null, nachname: string | null): string {
  const v = (vorname ?? "").trim()[0] ?? "";
  const n = (nachname ?? "").trim()[0] ?? "";
  return (v + n).toUpperCase() || "?";
}

export function name(
  person: { vorname: string | null; nachname: string | null; id: number },
): string {
  const teile = [person.vorname, person.nachname].filter(Boolean);
  return teile.length ? teile.join(" ") : `#${person.id}`;
}
