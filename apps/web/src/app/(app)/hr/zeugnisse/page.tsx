import { requireApp } from "@/lib/auth";
import { Zeugnisliste } from "./zeugnisliste";

export const metadata = { title: "Zeugnisse · ACM-Plattform" };

export default async function ZeugnissePage() {
  // Personenbezogene Leistungsdaten — keine reine Lesestufe.
  await requireApp("hr", "editor");
  return <Zeugnisliste />;
}
