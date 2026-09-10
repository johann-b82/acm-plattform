import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { AuditAnsicht } from "./audit-ansicht";

export const metadata = { title: "Audit · ACM-Plattform" };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireApp("quality");
  const { id } = await params;
  return (
    <AuditAnsicht id={id} darfSchreiben={hasLevel(session.apps, "quality", "editor")} />
  );
}
