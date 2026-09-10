import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Editor } from "./editor";

export const metadata = { title: "Zeichnung · ACM-Plattform" };

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
