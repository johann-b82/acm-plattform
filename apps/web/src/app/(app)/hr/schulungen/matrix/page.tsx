import { requireApp } from "@/lib/auth";
import { Schulungsmatrix } from "./schulungsmatrix";

export const metadata = { title: "Schulungsmatrix · ACM-Plattform" };

export default async function MatrixPage() {
  await requireApp("hr");
  return <Schulungsmatrix />;
}
