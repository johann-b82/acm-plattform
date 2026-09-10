import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { SchulungAnsicht } from "./schulung-ansicht";

export const metadata = { title: "Schulung · ACM-Plattform" };

export default async function SchulungPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireApp("hr");
  const { id } = await params;
  return <SchulungAnsicht id={id} darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
