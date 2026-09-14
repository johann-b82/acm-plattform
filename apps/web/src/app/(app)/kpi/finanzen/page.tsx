import { requireApp } from "@/lib/auth";
import { FinanzenDashboard } from "./finanzen-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/kpi/finanzen"]);

export default async function FinanzenPage() {
  await requireApp("kpi");
  return <FinanzenDashboard />;
}
