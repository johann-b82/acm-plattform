import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Lieferungsliste } from "./lieferungsliste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.atrLieferungen);

/** ATR-10: wer ATR öffnet, landet wie im Altsystem bei den Lieferungen. */
export default async function AtrPage() {
  const session = await requireApp("atr");
  return <Lieferungsliste darfSchreiben={hasLevel(session.apps, "atr", "editor")} />;
}
