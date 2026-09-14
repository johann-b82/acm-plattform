import { requireApp } from "@/lib/auth";
import { seitentitel, texte } from "@/lib/sprache-server";
import { Kacheln } from "@/components/kacheln";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr"]);

/** Die Unterbereiche des Personals. Die Kennzahlen sind einer davon — sonst
 *  hinge die halbe Personalarbeit unter einer Seite, die „Zahlen“ heißt.
 *  Einarbeitung und Dokumentenlauf haben keine eigene Kachel mehr: sie stehen
 *  wie im Altsystem unter Onboarding (NAV-01). */
const BEREICHE = [
  "/hr/kennzahlen",
  "/hr/organigramm",
  "/hr/kompetenzen",
  "/hr/schulungen",
  "/hr/onboarding",
  "/hr/zeugnisse",
] as const;

export default async function PersonalPage() {
  // Eigene Berechtigung, nicht `kpi`: hinter diesen Seiten liegen
  // Personenzeilen mit Gehalt, Geburtsdatum und Vorgesetzten.
  await requireApp("hr");
  const t = await texte();
  return (
    <Kacheln
      eintraege={BEREICHE.map((pfad) => ({
        pfad,
        name: t.pfad.seiten[pfad],
        beschreibung: t.personalHub.bereiche[pfad],
      }))}
    />
  );
}
