import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { MaschineAnsicht } from "./maschine-ansicht";

export const metadata = { title: "Maschine · ACM-Plattform" };

export default async function MaschinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireApp("production");
  const { id } = await params;
  return (
    <MaschineAnsicht
      id={id}
      darfSchreiben={hasLevel(session.apps, "production", "editor")}
    />
  );
}
