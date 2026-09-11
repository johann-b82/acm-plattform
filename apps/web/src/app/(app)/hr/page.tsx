import { requireApp } from "@/lib/auth";
import { seitentitel, texte } from "@/lib/sprache-server";
import { Kacheln } from "@/components/kacheln";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr"]);

/** Die Unterbereiche des Personals. Die Kennzahlen sind einer davon — sonst
 *  hinge die halbe Personalarbeit unter einer Seite, die „Zahlen“ heißt. */
const BEREICHE = [
  "/hr/kennzahlen",
  "/hr/organigramm",
  "/hr/kompetenzen",
  "/hr/schulungen",
  "/hr/onboarding",
  "/hr/einarbeitung",
  "/hr/dokumente",
  "/hr/zeugnisse",
] as const;

export default async function PersonalPage() {
  // Eigene Berechtigung, nicht `kpi`: hinter diesen Seiten liegen
  // Personenzeilen mit Gehalt, Geburtsdatum und Vorgesetzten.
  await requireApp("hr");
  const t = await texte();
  return (
    <Kacheln
      untertitel={t.personalHub.einleitung}
      eintraege={BEREICHE.map((pfad) => ({
        pfad,
        name: t.pfad.seiten[pfad],
        beschreibung: t.personalHub.bereiche[pfad],
      }))}
    />
  );
}
