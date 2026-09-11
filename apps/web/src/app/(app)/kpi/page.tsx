import { requireApp } from "@/lib/auth";
import { seitentitel, texte } from "@/lib/sprache-server";
import { Kacheln } from "@/components/kacheln";

export const generateMetadata = () => seitentitel((t) => t.kennzahlenHub.titel);

/** Die Fachbereiche des KPI-Dashboards. Name und Beschreibung stehen im
 *  Wörterbuch: der Name ist derselbe wie im Pfad, damit ein Verweis und die
 *  Überschrift dahinter nicht verschieden heißen.
 *
 *  Das Personal führt auf seine Kennzahlen, nicht auf den Personalbereich:
 *  wer von hier kommt, sucht Zahlen und nicht das Organigramm. */
const BEREICHE = [
  "/kpi/vertrieb",
  "/hr/kennzahlen",
  "/kpi/qualitaet",
  "/kpi/finanzen",
  "/kpi/einkauf",
  "/kpi/produktion",
  "/kpi/bewertung",
] as const;

export default async function KpiHubPage() {
  await requireApp("kpi");
  const t = await texte();
  return (
    <Kacheln
      untertitel={t.kennzahlenHub.einleitung}
      eintraege={BEREICHE.map((pfad) => ({
        pfad,
        name: pfad === "/hr/kennzahlen" ? t.pfad.seiten["/hr"] : t.pfad.seiten[pfad],
        beschreibung: t.kennzahlenHub.bereiche[pfad],
      }))}
    />
  );
}
