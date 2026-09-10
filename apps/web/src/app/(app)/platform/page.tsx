import { redirect } from "next/navigation";

/**
 * Die Verwaltung ist in die Einstellungen gezogen. Der Pfad bleibt: er steht
 * in der Tabelle `apps`, in Lesezeichen und in der Dokumentation.
 */
export default function PlatformPage() {
  redirect("/einstellungen#zugaenge");
}
