import { requireApp } from "@/lib/auth";
import { ZeugnisAnsicht } from "./zeugnis-ansicht";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.zeugnis);

export default async function ZeugnisPage({ params }: { params: Promise<{ id: string }> }) {
  await requireApp("hr", "editor");
  const { id } = await params;
  return <ZeugnisAnsicht id={id} />;
}
