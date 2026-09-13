import { redirect } from "next/navigation";

/**
 * Die Schulungsmatrix ist jetzt ein Abschnitt im Register „Stand der
 * Mitarbeiter“ (SCH-04). Die alte Adresse bleibt und leitet dorthin.
 */
export default function MatrixPage() {
  redirect("/hr/schulungen?ansicht=stand");
}
