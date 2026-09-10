import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Lieferungsliste } from "./lieferungsliste";

export const metadata = { title: "ATR-Lieferungen · ACM-Plattform" };

export default async function LieferungenPage() {
  const session = await requireApp("atr");
  return <Lieferungsliste darfSchreiben={hasLevel(session.apps, "atr", "editor")} />;
}
