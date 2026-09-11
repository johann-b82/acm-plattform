import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Matrixliste } from "./matrixliste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/kompetenzen"]);

export default async function KompetenzenPage() {
  const session = await requireApp("hr");
  return <Matrixliste darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
