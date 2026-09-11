import { requireApp } from "@/lib/auth";
import { hasLevel } from "@/lib/rechte";
import { NewsletterLeser } from "./leser";
import { seitentitel } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/newsletter"]);

export default async function NewsletterPage() {
  const session = await requireApp("newsletter");
  return <NewsletterLeser darfSchreiben={hasLevel(session.apps, "newsletter", "editor")} />;
}
