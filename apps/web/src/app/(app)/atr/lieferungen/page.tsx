import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Lieferungsliste } from "./lieferungsliste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.atrLieferungen);

export default async function LieferungenPage() {
  const session = await requireApp("atr");
  return <Lieferungsliste darfSchreiben={hasLevel(session.apps, "atr", "editor")} />;
}
