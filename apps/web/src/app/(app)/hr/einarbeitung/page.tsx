import { redirect } from "next/navigation";

/**
 * Die Einarbeitung hat keine eigene Seite mehr: sie steht unter Onboarding wie
 * im Altsystem (NAV-01). Die alte Adresse bleibt und springt auf ihren
 * Abschnitt — Lesezeichen und Verweise laufen so weiter.
 */
export default function EinarbeitungPage() {
  redirect("/hr/onboarding#einarbeitung");
}
