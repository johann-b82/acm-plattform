import { hasLevel, requireApp } from "@/lib/auth";
import { QualitaetDashboard } from "./qualitaet-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/kpi/qualitaet"]);

export default async function QualitaetPage() {
  const session = await requireApp("kpi");
  return <QualitaetDashboard darfUploads={hasLevel(session.apps, "uploads", "admin")} />;
}
