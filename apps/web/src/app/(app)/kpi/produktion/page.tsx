import { requireApp } from "@/lib/auth";
import { ProduktionDashboard } from "./produktion-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/kpi/produktion"]);

export default async function ProduktionPage() {
  await requireApp("kpi");
  return <ProduktionDashboard />;
}
