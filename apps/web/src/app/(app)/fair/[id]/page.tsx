import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Editor } from "./editor";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.zeichnung);

export default async function ZeichnungPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireApp("fair");
  const { id } = await params;
  return (
    <Editor id={id} darfSchreiben={hasLevel(session.apps, "fair", "editor")} />
  );
}
