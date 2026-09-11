import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { SchulungAnsicht } from "./schulung-ansicht";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.schulung);

export default async function SchulungPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireApp("hr");
  const { id } = await params;
  return <SchulungAnsicht id={id} darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
