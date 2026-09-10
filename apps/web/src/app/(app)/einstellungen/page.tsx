import { hasLevel } from "@/lib/rechte";
import { requireApp } from "@/lib/auth";
import { Einstellungen } from "./einstellungen";

export const metadata = { title: "Einstellungen · ACM-Plattform" };

export default async function EinstellungenPage() {
  const session = await requireApp("settings");
  return <Einstellungen darfAendern={hasLevel(session.apps, "settings", "editor")} />;
}
