import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Dokumentenlauf } from "./dokumentenlauf";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/dokumente"]);

export default async function DokumentePage() {
  const session = await requireApp("hr");
  return <Dokumentenlauf darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
