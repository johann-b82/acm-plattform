import { requireApp } from "@/lib/auth";
import { VertriebDashboard } from "./vertrieb-dashboard";

export const metadata = { title: "Vertrieb · ACM-Plattform" };

export default async function VertriebPage() {
  await requireApp("kpi");
  return <VertriebDashboard />;
}
