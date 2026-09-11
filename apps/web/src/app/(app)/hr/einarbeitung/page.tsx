import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Einarbeitung } from "./einarbeitung";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/einarbeitung"]);

export default async function EinarbeitungPage() {
  const session = await requireApp("hr");
  return <Einarbeitung darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
