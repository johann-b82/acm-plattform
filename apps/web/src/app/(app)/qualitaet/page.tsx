import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Auditliste } from "./auditliste";

export const metadata = { title: "Qualität · ACM-Plattform" };

export default async function QualitaetPage() {
  const session = await requireApp("quality");
  return <Auditliste darfSchreiben={hasLevel(session.apps, "quality", "editor")} />;
}
