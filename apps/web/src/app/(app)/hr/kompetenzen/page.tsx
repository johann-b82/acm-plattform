import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { Matrixliste } from "./matrixliste";

export const metadata = { title: "Kompetenzen · ACM-Plattform" };

export default async function KompetenzenPage() {
  const session = await requireApp("hr");
  return <Matrixliste darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
