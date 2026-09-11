import { requireApp } from "@/lib/auth";
import { Schulungsmatrix } from "./schulungsmatrix";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.schulungsmatrix);

export default async function MatrixPage() {
  await requireApp("hr");
  return <Schulungsmatrix />;
}
