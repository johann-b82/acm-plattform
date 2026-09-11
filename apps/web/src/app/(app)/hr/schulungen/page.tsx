import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Schulungsuebersicht } from "./schulungsuebersicht";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/schulungen"]);

export default async function SchulungenPage() {
  const session = await requireApp("hr");
  return <Schulungsuebersicht darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
