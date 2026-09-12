import { hasLevel, requireApp } from "@/lib/auth";
import { EinkaufDashboard } from "./einkauf-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/kpi/einkauf"]);

export default async function EinkaufPage() {
  const session = await requireApp("kpi");
  return <EinkaufDashboard darfUploads={hasLevel(session.apps, "uploads", "admin")} />;
}
