import { requireApp } from "@/lib/auth";
import { Einstellungen } from "./einstellungen";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/einstellungen"]);

/**
 * Die Einstellungen gehören der Plattform-Verwaltung. Was hier steht, gilt für
 * alle — ein Zielwert, eine Vorlage je Programm, ein Eingangsordner. Deshalb
 * ein Tor für die ganze Seite und keine Rechteprüfung je Abschnitt.
 */
export default async function EinstellungenPage() {
  const session = await requireApp("platform", "admin");
  return <Einstellungen eigeneId={session.userId} />;
}
