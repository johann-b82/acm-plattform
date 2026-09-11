import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { AuditAnsicht } from "./audit-ansicht";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.audit);

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireApp("quality");
  const { id } = await params;
  return (
    <AuditAnsicht id={id} darfSchreiben={hasLevel(session.apps, "quality", "editor")} />
  );
}
