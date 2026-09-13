import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Teilekatalog } from "./teilekatalog";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.atrTeilekatalog);

export default async function TeilekatalogPage() {
  const session = await requireApp("atr");
  return <Teilekatalog darfSchreiben={hasLevel(session.apps, "atr", "editor")} />;
}
