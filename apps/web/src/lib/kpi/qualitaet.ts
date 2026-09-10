import { rpc, takt } from "@/lib/kpi/gemeinsam";

/**
 * Audit-Findings. Rechenweg in Alembic 0006.
 *
 * Gezählt werden Zeilen, nicht Mengen: ein Befund ist ein Befund, unabhängig
 * davon, wie viele Teile betroffen sind. Das Level steht in der Quelldatei
 * nicht in einer Spalte, sondern im Freitext; wo es nicht zu erkennen war,
 * zählt die Zeile nirgends und taucht in der Diagnoseliste auf.
 */

export interface AuditSumme {
  level_1: number;
  level_2: number;
  ohne_level: number;
}

export interface AuditVerlaufZeile {
  bucket: string;
  art: string;
  level_1: number;
  level_2: number;
}

export interface AuditOhneLevel {
  report_nr: string;
  report_date: string;
  art: string | null;
  customer_name: string | null;
  designation: string | null;
}

/** Die vier Audit-Codes, wie sie in der Quelldatei stehen. */
export const AUDIT_ARTEN = ["BH AUD", "EX AUD", "IN AUD", "KU AUD"] as const;

export const AUDIT_LABEL: Record<string, string> = {
  "BH AUD": "Behörde",
  "EX AUD": "Extern",
  "IN AUD": "Intern",
  "KU AUD": "Kunde",
};

export const qualitaetApi = {
  audits: async (von: string | null, bis: string | null, arten: string[] | null): Promise<AuditSumme> => {
    const rows = await rpc<AuditSumme[]>("kpi_qualitaet_audits", { von, bis, arten });
    return rows[0] ?? { level_1: 0, level_2: 0, ohne_level: 0 };
  },
  verlauf: (von: string | null, bis: string | null, arten: string[] | null) =>
    rpc<AuditVerlaufZeile[]>("kpi_qualitaet_audits_verlauf", {
      von,
      bis,
      takt: takt(von, bis),
      arten,
    }),
  ohneLevel: (von: string | null, bis: string | null, arten: string[] | null, grenze = 500) =>
    rpc<AuditOhneLevel[]>("kpi_qualitaet_audits_ohne_level", { von, bis, grenze, arten }),
};

/**
 * Die nach Art aufgeschlüsselten Verlaufszeilen zu einem Punkt je Bucket
 * zusammenfassen. Die Summe der Aufschlüsselung ist der Bucket-Gesamtwert.
 */
export function verlaufJeBucket(
  zeilen: readonly AuditVerlaufZeile[],
): { bucket: string; level_1: number; level_2: number }[] {
  const nach = new Map<string, { bucket: string; level_1: number; level_2: number }>();
  for (const z of zeilen) {
    const eintrag = nach.get(z.bucket) ?? { bucket: z.bucket, level_1: 0, level_2: 0 };
    eintrag.level_1 += Number(z.level_1);
    eintrag.level_2 += Number(z.level_2);
    nach.set(z.bucket, eintrag);
  }
  return [...nach.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}
