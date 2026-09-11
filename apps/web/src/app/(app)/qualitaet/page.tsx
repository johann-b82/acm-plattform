import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Auditliste } from "./auditliste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/qualitaet"]);

export default async function QualitaetPage() {
  const session = await requireApp("quality");
  return <Auditliste darfSchreiben={hasLevel(session.apps, "quality", "editor")} />;
}
