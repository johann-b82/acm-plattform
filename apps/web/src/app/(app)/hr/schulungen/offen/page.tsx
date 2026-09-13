import { redirect } from "next/navigation";

/**
 * Die offenen Schulungen stehen jetzt im Register „Stand der Mitarbeiter“
 * (SCH-04). Die alte Adresse bleibt und leitet dorthin.
 */
export default function OffenPage() {
  redirect("/hr/schulungen?ansicht=stand");
}
