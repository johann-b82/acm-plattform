import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { PersonalDashboard } from "./hr-dashboard";

export const metadata = { title: "Personal · ACM-Plattform" };

export default async function PersonalPage() {
  // Eigene Berechtigung, nicht `kpi`: hinter dieser Seite liegen
  // Personenzeilen mit Gehalt, Geburtsdatum und Vorgesetzten.
  const session = await requireApp("hr");
  return <PersonalDashboard darfAbgleichen={hasLevel(session.apps, "hr", "admin")} />;
}
