import { requireApp } from "@/lib/auth";
import { EinkaufDashboard } from "./einkauf-dashboard";

export const metadata = { title: "Einkauf · ACM-Plattform" };

export default async function EinkaufPage() {
  await requireApp("kpi");
  return <EinkaufDashboard />;
}
