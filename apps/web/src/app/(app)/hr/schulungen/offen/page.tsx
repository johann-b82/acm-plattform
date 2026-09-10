import { requireApp } from "@/lib/auth";
import { OffeneSchulungen } from "./offene-schulungen";

export const metadata = { title: "Offene Schulungen · ACM-Plattform" };

export default async function OffenPage() {
  await requireApp("hr");
  return <OffeneSchulungen />;
}
