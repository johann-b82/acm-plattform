import { requireApp } from "@/lib/auth";
import { FeedbackListe } from "./feedback-liste";

export const metadata = { title: "Meldungen · ACM-Plattform" };

export default async function FeedbackPage() {
  await requireApp("platform", "admin");
  return <FeedbackListe />;
}
