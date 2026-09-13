import { redirect } from "next/navigation";

/**
 * Der Dokumentenlauf heißt jetzt „Einarbeitungs- & Schulungsvorgänge“ und
 * steht unter Onboarding wie im Altsystem (DOK-02). Die alte Adresse bleibt
 * und springt auf den Abschnitt.
 */
export default function DokumentePage() {
  redirect("/hr/onboarding#vorgaenge");
}
