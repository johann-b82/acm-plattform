import { requireApp } from "@/lib/auth";
import { Organigramm } from "./organigramm";

export const metadata = { title: "Organigramm · ACM-Plattform" };

export default async function OrganigrammPage() {
  await requireApp("hr");
  return <Organigramm />;
}
