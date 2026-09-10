import { requireApp } from "@/lib/auth";
import { FinanzenDashboard } from "./finanzen-dashboard";

export const metadata = { title: "Finanzen · ACM-Plattform" };

export default async function FinanzenPage() {
  await requireApp("kpi");
  return <FinanzenDashboard />;
}
