import { hasLevel, requireApp } from "@/lib/auth";
import { FinanzenDashboard } from "./finanzen-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/kpi/finanzen"]);

export default async function FinanzenPage() {
  const session = await requireApp("kpi");
  return <FinanzenDashboard darfUploads={hasLevel(session.apps, "uploads", "admin")} />;
}
