import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Teilekatalog } from "./teilekatalog";

export const metadata = { title: "ATR · ACM-Plattform" };

export default async function AtrPage() {
  const session = await requireApp("atr");
  return <Teilekatalog darfSchreiben={hasLevel(session.apps, "atr", "editor")} />;
}
