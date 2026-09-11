import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Maschinenliste } from "./maschinenliste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/produktion"]);

export default async function ProduktionPage() {
  const session = await requireApp("production");
  return <Maschinenliste darfSchreiben={hasLevel(session.apps, "production", "editor")} />;
}
