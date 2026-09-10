import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { NewsletterLeser } from "./leser";

export const metadata = { title: "Newsletter · ACM-Plattform" };

export default async function NewsletterPage() {
  const session = await requireApp("newsletter");
  return <NewsletterLeser darfSchreiben={hasLevel(session.apps, "newsletter", "editor")} />;
}
