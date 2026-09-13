import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Schulungen, type Ansicht } from "./schulungen";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/schulungen"]);

const ANSICHTEN: Ansicht[] = ["bearbeiten", "zuweisen", "stand"];

export default async function SchulungenPage({
  searchParams,
}: {
  searchParams: Promise<{ ansicht?: string }>;
}) {
  const session = await requireApp("hr");
  const { ansicht } = await searchParams;
  const start = ANSICHTEN.find((a) => a === ansicht);
  return <Schulungen darfSchreiben={hasLevel(session.apps, "hr", "editor")} start={start} />;
}
