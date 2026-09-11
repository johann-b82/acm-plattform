import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { BewertungSeite } from "./bewertung";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.kpiBewertung);

export default async function BewertungPage() {
  const session = await requireApp("kpi");
  // Schreiben darf, wer die Einstellungen bearbeiten darf — dieselbe Schranke
  // wie fuer die Zielwerte. Die Policy entscheidet, die Oberflaeche blendet
  // nur aus, was die Datenbank ohnehin abweist.
  return <BewertungSeite darfSchreiben={hasLevel(session.apps, "settings", "editor")} />;
}
