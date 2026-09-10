import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Eintritte } from "./eintritte";

export const metadata = { title: "Onboarding · ACM-Plattform" };

export default async function OnboardingPage() {
  const session = await requireApp("hr");
  return <Eintritte darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
