import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Dokumentenlauf } from "./dokumentenlauf";

export const metadata = { title: "Dokumentenlauf · ACM-Plattform" };

export default async function DokumentePage() {
  const session = await requireApp("hr");
  return <Dokumentenlauf darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
