import { requireApp } from "@/lib/auth";
import { Verwaltung } from "./verwaltung";

export const metadata = { title: "Verwaltung · ACM-Plattform" };

export default async function PlatformPage() {
  const session = await requireApp("platform", "admin");
  return <Verwaltung eigeneId={session.userId} />;
}
