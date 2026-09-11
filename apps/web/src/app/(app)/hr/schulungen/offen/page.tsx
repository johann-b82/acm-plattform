import { requireApp } from "@/lib/auth";
import { OffeneSchulungen } from "./offene-schulungen";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.offeneSchulungen);

export default async function OffenPage() {
  await requireApp("hr");
  return <OffeneSchulungen />;
}
