import { requireApp } from "@/lib/auth";
import { SensorDashboard } from "./sensor-dashboard";

export const metadata = { title: "Sensoren · ACM-Plattform" };

export default async function SensorenPage() {
  await requireApp("sensors");
  return <SensorDashboard />;
}
