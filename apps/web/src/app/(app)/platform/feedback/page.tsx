import { requireApp } from "@/lib/auth";
import { FeedbackListe } from "./feedback-liste";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/platform/feedback"]);

export default async function FeedbackPage() {
  await requireApp("platform", "admin");
  return <FeedbackListe />;
}
