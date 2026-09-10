import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Einarbeitung } from "./einarbeitung";

export const metadata = { title: "Einarbeitung · ACM-Plattform" };

export default async function EinarbeitungPage() {
  const session = await requireApp("hr");
  return <Einarbeitung darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
