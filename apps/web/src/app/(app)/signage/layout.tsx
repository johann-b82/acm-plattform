import { requireApp } from "@/lib/auth";
import { SignageTabs } from "./tabs";
import { seitentitel, texte } from "@/lib/sprache-server";
import { Seitenkopf } from "@/components/seitenkopf";

export const generateMetadata = () => seitentitel((t) => t.pfad.seiten["/signage"]);

/**
 * Alle Signage-Seiten verlangen `signage: admin` (oder `platform: admin`).
 * Die Prüfung liegt hier in der Data-Access-Schicht, nicht im Proxy — der
 * Proxy prüft zusätzlich, und die Signage-API prüft das Token selbst.
 */
export default async function SignageLayout({ children }: { children: React.ReactNode }) {
  await requireApp("signage", "admin");
  const t = await texte();
  return (
    <div className="space-y-6">
      <Seitenkopf untertitel={t.signage.einleitung} />
      <SignageTabs />
      {children}
    </div>
  );
}
