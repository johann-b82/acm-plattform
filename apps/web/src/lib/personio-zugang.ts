import { computeJson } from "@/lib/compute";

/**
 * Die Personio-Zugangsdaten.
 *
 * Geschrieben wird über `compute` — nur dort liegt der Schlüssel, mit dem sie
 * verschlüsselt in der Datenbank landen. Zurück kommen sie nie: die Antwort
 * sagt bloß, ob etwas hinterlegt ist, woher es gilt, seit wann und von wem.
 */

export interface PersonioStand {
  gesetzt: boolean;
  /** "datenbank" = über diese Maske eingetragen, "umgebung" = aus der .env. */
  quelle: "datenbank" | "umgebung" | null;
  geaendert_am: string | null;
  geaendert_von: string | null;
  /** Ohne GEHEIM_SCHLUESSEL lässt sich nichts ablegen. */
  schluessel_bereit: boolean;
}

export interface Pruefung {
  erreichbar: boolean;
  meldung: string | null;
}

/** Ergebnis eines Abgleichs, wie `compute` es meldet (SET-08). */
export interface AbgleichErgebnis {
  status: string;
  mitarbeiter: number;
  anwesenheiten: number;
  abwesenheiten: number;
  entfernt: number;
  dauer_sekunden: number;
  fehler: string | null;
}

const PFAD = "/api/einstellungen/personio";

export const personioKeys = {
  stand: () => ["personio-zugang"] as const,
};

export const personioZugang = {
  stand: () => computeJson<PersonioStand>(PFAD),
  setzen: (client_id: string, client_secret: string) =>
    computeJson<PersonioStand>(PFAD, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, client_secret }),
    }),
  entfernen: () => computeJson<PersonioStand>(PFAD, { method: "DELETE" }),
  pruefen: () => computeJson<Pruefung>(`${PFAD}/pruefen`, { method: "POST" }),
  /** „Daten aktualisieren“ — der bestehende Abgleich, von Hand angestoßen. */
  abgleichen: () => computeJson<AbgleichErgebnis>("/api/hr/sync", { method: "POST" }),
};
