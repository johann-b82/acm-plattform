import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Schulungsuebersicht } from "./schulungsuebersicht";

export const metadata = { title: "Schulungen · ACM-Plattform" };

export default async function SchulungenPage() {
  const session = await requireApp("hr");
  return <Schulungsuebersicht darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
