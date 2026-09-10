import { requireApp } from "@/lib/auth";
import { QualitaetDashboard } from "./qualitaet-dashboard";

export const metadata = { title: "Qualität · ACM-Plattform" };

export default async function QualitaetPage() {
  await requireApp("kpi");
  return <QualitaetDashboard />;
}
