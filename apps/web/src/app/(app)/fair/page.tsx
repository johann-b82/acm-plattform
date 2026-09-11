import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Zeichnungsliste } from "./zeichnungsliste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/fair"]);

export default async function FairPage() {
  const session = await requireApp("fair");
  return <Zeichnungsliste darfSchreiben={hasLevel(session.apps, "fair", "editor")} />;
}
