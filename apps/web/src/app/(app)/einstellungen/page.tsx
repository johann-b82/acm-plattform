import { requireSession } from "@/lib/auth";
import { Einstellungen } from "./einstellungen";

export const metadata = { title: "Einstellungen · ACM-Plattform" };

/**
 * Die Seite selbst ist für jede angemeldete Person offen — die Gruppen darin
 * nicht. Ein Tor auf die App `settings` wäre falsch: dann käme eine
 * ATR-Bearbeiterin nicht an ihren Eingangsordner, obwohl die Datenbank ihn ihr
 * gibt.
 */
export default async function EinstellungenPage() {
  const session = await requireSession();
  return <Einstellungen apps={session.apps} eigeneId={session.userId} />;
}
