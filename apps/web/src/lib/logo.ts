import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Das Firmenlogo für die erzeugten Formblätter.
 *
 * Nur PNG oder JPEG: openpyxl kann kein SVG einbetten, und ein SVG müsste
 * gereinigt werden, weil es Skripte tragen kann. Der Fall entfällt damit,
 * statt behandelt zu werden.
 */

export const LOGO_EIMER = "plattform";
export const LOGO_TYPEN = ["image/png", "image/jpeg"];
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

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
      throw new Error("Das Logo muss eine PNG- oder JPEG-Datei sein.");
    }
    if (datei.size > LOGO_MAX_BYTES) throw new Error("Das Logo ist größer als 5 MB.");

    const client = sb();
    const { data: sitzung } = await client.auth.getUser();
    const kennung = sitzung.user?.id;
    if (!kennung) throw new Error("Keine Sitzung.");

    const alt = await logoApi.stand();
    const endung = datei.type === "image/png" ? "png" : "jpg";
    const pfad = `${kennung}/${crypto.randomUUID()}.${endung}`;
    const { error: speicherFehler } = await client.storage
      .from(LOGO_EIMER)
      .upload(pfad, datei, { contentType: datei.type });
    if (speicherFehler) throw new Error(speicherFehler.message);

    const { data, error } = await client
      .from("plattform_logo")
      .update({
        pfad,
        dateiname: datei.name,
        mime: datei.type,
        geaendert_am: new Date().toISOString(),
      })
      .eq("id", true)
      .select("pfad");
    if (error || !data?.length) {
      await client.storage.from(LOGO_EIMER).remove([pfad]);
      throw new Error(error?.message ?? "Nicht gespeichert — fehlt das Recht?");
    }
    // Erst jetzt die alte Datei weg: vorher hätte ein Fehler beides genommen.
    if (alt?.pfad) await client.storage.from(LOGO_EIMER).remove([alt.pfad]);
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
