import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Durchsicht } from "./durchsicht";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.lieferung);

export default async function LieferungPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireApp("atr");
  const { id } = await params;
  return <Durchsicht id={id} darfSchreiben={hasLevel(session.apps, "atr", "editor")} />;
}
