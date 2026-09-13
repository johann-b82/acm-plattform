import { computeJson } from "@/lib/compute";

/** Was die Einstellungsseite über die AD-Anbindung weiß — ohne das Passwort. */
export interface AdKonfig {
  aktiv: boolean;
  host: string | null;
  port: number;
  upn_suffix: string | null;
  basis_dn: string | null;
  dienst_konto_dn: string | null;
  gruppen_basis_dn: string | null;
  tls_pruefen: boolean;
  dienst_passwort_gesetzt: boolean;
  schluessel_bereit: boolean;
}

export const adKeys = { konfig: () => ["ad-konfig"] as const };

export const adApi = {
  lesen: () => computeJson<AdKonfig>("/api/einstellungen/ad"),
  speichern: (k: Omit<AdKonfig, "dienst_passwort_gesetzt" | "schluessel_bereit">) =>
    computeJson<AdKonfig>("/api/einstellungen/ad", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(k),
    }),
  passwortSetzen: (passwort: string) =>
    computeJson<void>("/api/einstellungen/ad/passwort", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwort }),
    }),
};
