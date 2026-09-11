import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { PersonalDashboard } from "./hr-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr"]);

export default async function PersonalPage() {
  // Eigene Berechtigung, nicht `kpi`: hinter dieser Seite liegen
  // Personenzeilen mit Gehalt, Geburtsdatum und Vorgesetzten.
  const session = await requireApp("hr");
  return <PersonalDashboard darfAbgleichen={hasLevel(session.apps, "hr", "admin")} />;
}
