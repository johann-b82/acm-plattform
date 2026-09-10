import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { BewertungSeite } from "./bewertung";

export const metadata = { title: "KPI-Bewertung · ACM-Plattform" };

export default async function BewertungPage() {
  const session = await requireApp("kpi");
  // Schreiben darf, wer die Einstellungen bearbeiten darf — dieselbe Schranke
  // wie fuer die Zielwerte. Die Policy entscheidet, die Oberflaeche blendet
  // nur aus, was die Datenbank ohnehin abweist.
  return <BewertungSeite darfSchreiben={hasLevel(session.apps, "settings", "editor")} />;
}
