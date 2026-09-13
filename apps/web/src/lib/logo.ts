import { LOGO_EIMER, LOGO_MAX_BYTES, LOGO_TYPEN } from "@/lib/logo-gemeinsam";
import { computeFetch } from "@/lib/compute";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Das Firmenlogo — oben links in der Anwendung und auf jedem Formblatt.
 *
 * PNG, JPEG oder SVG bis 5 MB (SET-07). Hochgeladen wird über `compute`, nicht
 * direkt in den Eimer: nur dort lässt sich der Typ am Inhalt prüfen, ein SVG
 * reinigen (Skripte, Handler, externe Verweise entfernen) und ein Raster für
 * die openpyxl-Formblätter erzeugen. Angezeigt wird weiter über Storage.
 */

export { LOGO_EIMER, LOGO_MAX_BYTES, LOGO_TYPEN } from "@/lib/logo-gemeinsam";

export interface LogoStand {
  pfad: string | null;
  dateiname: string | null;
  mime: string | null;
  geaendert_am: string;
}

export const logoKeys = { stand: () => ["logo"] as const };

function sb() {
  return supabaseBrowser();
}

export const logoApi = {
  stand: async (): Promise<LogoStand | null> => {
    const { data, error } = await sb()
      .from("plattform_logo")
      .select("pfad,dateiname,mime,geaendert_am")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as LogoStand) ?? null;
  },

  hochladen: async (datei: File): Promise<void> => {
    if (!LOGO_TYPEN.includes(datei.type)) {
      throw new Error("Das Logo muss eine PNG-, JPEG- oder SVG-Datei sein.");
    }
    if (datei.size > LOGO_MAX_BYTES) throw new Error("Das Logo ist größer als 5 MB.");

    // Über compute: dort wird geprüft, ein SVG gereinigt und gerastert.
    const form = new FormData();
    form.append("datei", datei);
    const antwort = await computeFetch("/api/einstellungen/logo", { method: "POST", body: form });
    if (!antwort.ok) {
      const koerper = await antwort.json().catch(() => null);
      const detail =
        koerper && typeof koerper === "object" && "detail" in koerper
          ? String((koerper as { detail: unknown }).detail)
          : `HTTP ${antwort.status}`;
      throw new Error(detail);
    }
  },

  url: async (stand: LogoStand): Promise<string | null> => {
    if (!stand.pfad) return null;
    const { data, error } = await sb()
      .storage.from(LOGO_EIMER)
      .createSignedUrl(stand.pfad, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
};
