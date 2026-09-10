import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Maschinenliste } from "./maschinenliste";

export const metadata = { title: "Produktion · ACM-Plattform" };

export default async function ProduktionPage() {
  const session = await requireApp("production");
  return <Maschinenliste darfSchreiben={hasLevel(session.apps, "production", "editor")} />;
}
