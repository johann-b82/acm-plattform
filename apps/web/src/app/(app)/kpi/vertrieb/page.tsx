import { hasLevel, requireApp } from "@/lib/auth";
import { VertriebDashboard } from "./vertrieb-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/kpi/vertrieb"]);

export default async function VertriebPage() {
  const session = await requireApp("kpi");
  return <VertriebDashboard darfUploads={hasLevel(session.apps, "uploads", "admin")} />;
}
