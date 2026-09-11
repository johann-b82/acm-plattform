import { requireApp } from "@/lib/auth";
import { UploadsAdmin } from "./uploads-admin";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/uploads"]);

export default async function UploadsPage() {
  await requireApp("uploads", "admin");
  return <UploadsAdmin />;
}
