import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { MatrixAnsicht } from "./matrix-ansicht";

export const metadata = { title: "Qualifikationsmatrix · ACM-Plattform" };

export default async function MatrixPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireApp("hr");
  const { id } = await params;
  return <MatrixAnsicht id={id} darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
