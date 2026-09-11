import { requireApp } from "@/lib/auth";
import { Organigramm } from "./organigramm";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/hr/organigramm"]);

export default async function OrganigrammPage() {
  await requireApp("hr");
  return <Organigramm />;
}
