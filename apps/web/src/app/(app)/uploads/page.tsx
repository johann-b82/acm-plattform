import { requireApp } from "@/lib/auth";
import { UploadsAdmin } from "./uploads-admin";

export const metadata = { title: "Uploads · ACM-Plattform" };

export default async function UploadsPage() {
  await requireApp("uploads", "admin");
  return <UploadsAdmin />;
}
