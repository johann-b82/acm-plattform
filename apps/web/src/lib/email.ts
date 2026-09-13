import { computeJson } from "@/lib/compute";

/**
 * Der E-Mail-Versand über Microsoft 365 (SET-16).
 *
 * Alles geht über `compute`: dort liegen das Client-Secret und das
 * Erneuerungstoken der delegierten Anmeldung verschlüsselt, und dort spricht
 * der Dienst mit Microsoft Graph. Die Maske erfährt nur, ob ein Geheimnis
 * gesetzt ist — nie den Wert. Verschickt wird ausschließlich auf die
 * ausdrückliche Testmail-Aktion, nicht beim Öffnen oder Speichern.
 */
export type EmailModus = "app" | "delegiert";

export interface EmailStand {
  aktiv: boolean;
  modus: EmailModus;
  tenant_id: string | null;
  client_id: string | null;
  absender: string | null;
  absender_name: string | null;
  secret_gesetzt: boolean;
  delegiert_verbunden: boolean;
  delegiert_konto: string | null;
  schluessel_bereit: boolean;
}

export interface EmailEingabe {
  aktiv: boolean;
  modus: EmailModus;
  tenant_id: string;
  client_id: string;
  /** Leer lässt das hinterlegte Secret stehen. */
  client_secret: string;
  absender: string;
  absender_name: string;
}

export interface Versand {
  ok: boolean;
  fehler: string | null;
}

export interface Geraetecode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

export interface Anmeldung {
  status: "pending" | "complete" | "error";
  konto: string | null;
  fehler: string | null;
}

const PFAD = "/api/einstellungen/email";

export const emailKeys = { stand: () => ["email-einstellungen"] as const };

export const emailApi = {
  stand: () => computeJson<EmailStand>(PFAD),
  speichern: (eingabe: EmailEingabe) =>
    computeJson<EmailStand>(PFAD, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eingabe),
    }),
  testen: (an: string) =>
    computeJson<Versand>(`${PFAD}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ an }),
    }),
  delegiertStart: () => computeJson<Geraetecode>(`${PFAD}/delegiert/start`, { method: "POST" }),
  delegiertAbfragen: (device_code: string) =>
    computeJson<Anmeldung>(`${PFAD}/delegiert/abfragen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code }),
    }),
  delegiertTrennen: () => computeJson<EmailStand>(`${PFAD}/delegiert/trennen`, { method: "POST" }),
};
