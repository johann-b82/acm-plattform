import { requireApp } from "@/lib/auth";
import { ZeugnisAnsicht } from "./zeugnis-ansicht";

export const metadata = { title: "Zeugnis · ACM-Plattform" };

export default async function ZeugnisPage({ params }: { params: Promise<{ id: string }> }) {
  await requireApp("hr", "editor");
  const { id } = await params;
  return <ZeugnisAnsicht id={id} />;
}
