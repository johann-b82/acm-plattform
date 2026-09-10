import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Zeichnungsliste } from "./zeichnungsliste";

export const metadata = { title: "FAIR · ACM-Plattform" };

export default async function FairPage() {
  const session = await requireApp("fair");
  return <Zeichnungsliste darfSchreiben={hasLevel(session.apps, "fair", "editor")} />;
}
