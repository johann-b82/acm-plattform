import { rpc, takt } from "@/lib/kpi/gemeinsam";

/**
 * Aufträge in Verzug. Rechenweg in Alembic 0005, Sicht `auftrag_verzug`.
 *
 * Gezählt wird ein Auftrag nur, wenn sein Ausgang feststeht: geliefert oder
 * Termin verstrichen. Ein offener Auftrag mit Termin in der Zukunft taucht
 * hier nicht auf — er ist weder pünktlich noch verspätet.
 */

export interface VerzugSumme {
  quote: number | null;
  in_verzug: number;
  gesamt: number;
  verzug_schnitt: number | null;
}

export interface VerzugVerlaufPunkt {
  bucket: string;
  quote: number | null;
  in_verzug: number;
  gesamt: number;
}

export interface VerzugZeile {
  vorgang_nr: string;
  customer_name: string | null;
  ziel: string;
  ist: string | null;
  verzug_tage: number;
  art: "verspaetet" | "offen";
}

/**
 * Höchstwert für die Verzugsquote. Im Altprojekt liegt er als
 * `target_produktion_verzug` in den Einstellungen; die sind noch nicht
 * portiert, deshalb hier als Konstante mit demselben Ausgangswert.
 */
export const VERZUG_ZIEL = 0.1;

export const ART_LABEL: Record<VerzugZeile["art"], string> = {
  verspaetet: "zu spät geliefert",
  offen: "offen, überfällig",
};

export const produktionApi = {
  verzug: async (von: string | null, bis: string | null): Promise<VerzugSumme> => {
    const rows = await rpc<VerzugSumme[]>("kpi_produktion_verzug", { von, bis });
    return rows[0] ?? { quote: null, in_verzug: 0, gesamt: 0, verzug_schnitt: null };
  },
  verlauf: (von: string | null, bis: string | null) =>
    rpc<VerzugVerlaufPunkt[]>("kpi_produktion_verzug_verlauf", { von, bis, takt: takt(von, bis) }),
  liste: (von: string | null, bis: string | null, grenze = 500) =>
    rpc<VerzugZeile[]>("kpi_produktion_verzug_liste", { von, bis, grenze }),
};
