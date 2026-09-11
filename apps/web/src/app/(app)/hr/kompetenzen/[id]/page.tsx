import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { MatrixAnsicht } from "./matrix-ansicht";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.qualifikationsmatrix);

export default async function MatrixPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireApp("hr");
  const { id } = await params;
  return <MatrixAnsicht id={id} darfSchreiben={hasLevel(session.apps, "hr", "editor")} />;
}
