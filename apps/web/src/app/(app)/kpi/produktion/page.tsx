import { requireApp } from "@/lib/auth";
import { ProduktionDashboard } from "./produktion-dashboard";

export const metadata = { title: "Produktion · ACM-Plattform" };

export default async function ProduktionPage() {
  await requireApp("kpi");
  return <ProduktionDashboard />;
}
