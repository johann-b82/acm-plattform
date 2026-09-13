import { hasLevel, requireApp } from "@/lib/auth";
import { ProduktionDashboard } from "./produktion-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/kpi/produktion"]);

export default async function ProduktionPage() {
  const session = await requireApp("kpi");
  return <ProduktionDashboard darfUploads={hasLevel(session.apps, "uploads", "admin")} />;
}
