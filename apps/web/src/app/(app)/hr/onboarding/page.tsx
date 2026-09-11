import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Eintritte } from "./eintritte";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/onboarding"]);

export default async function OnboardingPage() {
  const session = await requireApp("hr");
  return <Eintritte darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
