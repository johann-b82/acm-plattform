import { requireApp } from "@/lib/auth";
import { Zeugnisliste } from "./zeugnisliste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/zeugnisse"]);

export default async function ZeugnissePage() {
  // Personenbezogene Leistungsdaten — keine reine Lesestufe.
  await requireApp("hr", "editor");
  return <Zeugnisliste />;
}
