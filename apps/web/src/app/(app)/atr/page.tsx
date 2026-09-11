import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Teilekatalog } from "./teilekatalog";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/atr"]);

export default async function AtrPage() {
  const session = await requireApp("atr");
  return <Teilekatalog darfSchreiben={hasLevel(session.apps, "atr", "editor")} />;
}
