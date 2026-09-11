import { requireApp } from "@/lib/auth";
import { SensorDashboard } from "./sensor-dashboard";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/sensoren"]);

export default async function SensorenPage() {
  await requireApp("sensors");
  return <SensorDashboard />;
}
