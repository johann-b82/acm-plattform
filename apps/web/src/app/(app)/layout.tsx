import Link from "next/link";
import { CircleHelp } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { sprache, texte } from "@/lib/sprache-server";
import { hasLevel } from "@/lib/rechte";
import { logoAdresse } from "@/lib/logo-server";
import { ladeErscheinung } from "@/lib/erscheinung-server";
import { Providers } from "@/components/providers";
import { Brotkrumen } from "@/components/brotkrumen";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Benutzermenue } from "@/components/kopfzeile/benutzermenue";
import { KNOPF } from "@/components/kopfzeile/knopf";
import { FeedbackGlocke } from "@/components/feedback/glocke";
import { MassnahmenKnopf } from "@/components/kpi/massnahmen-knopf";
import { MeldeKnopf } from "@/components/feedback/melde-knopf";

/**
 * Shell für alle angemeldeten Seiten. Läuft immer pro Anfrage (die Sitzung
 * kommt aus Cookies), deshalb werden hier die Laufzeitwerte für den
 * Supabase-Client im Browser gelesen und an die Provider gereicht.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const logo = await logoAdresse();
  const { appName } = await ladeErscheinung();
  const t = await texte();
  const gewaehlt = await sprache();
  const darfMeldungen = session.apps.platform === "admin";
  // Wer eine Maßnahme abhaken darf, ist derselbe Kreis wie bei den Zielwerten.
  const darfMassnahmen = hasLevel(session.apps, "settings", "editor");
  return (
    <Providers
      supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!}
      supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}
    >
      <SprachAnbieter sprache={gewaehlt}>
        <div className="min-h-screen">
          <header className="relative flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
            <div className="flex min-w-0 items-center gap-4">
              <Link href="/" className="flex items-center gap-2" aria-label={t.kopf.uebersicht}>
                {logo ? (
                  // Eine signierte Adresse auf eine hochgeladene Datei; `next/image`
                  // bräuchte dafür eine Host-Freigabe und brächte hier nichts.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo}
                    alt={appName}
                    className="h-8 w-auto max-w-44 object-contain"
                  />
                ) : (
                  <span className="font-semibold tracking-tight">{appName}</span>
                )}
              </Link>
              {/* Der Pfad steht neben dem Logo, nicht über dem Inhalt: oben links
                  fängt das Auge an, und dort steht ohnehin schon der Weg nach
                  Hause. */}
              <Brotkrumen />
            </div>
            {/* Kein mittiger Seitentitel mehr: die Brotkrumen oben links
                zeigen den Weg samt aktueller Seite schon an. */}
            {/* Zeichen statt Beschriftungen: drei Wörter nebeneinander drängten
                  die Kopfzeile zu, und gemeint ist jedes Mal dasselbe wie das
                  Zeichen. Die Beschriftung bleibt als `aria-label` und als
                  `title` — wer die Maus darüber hält oder einen Screenreader
                  benutzt, bekommt sie. Die Adresse bleibt Text: sie sagt, wer
                  angemeldet ist, und dafür gibt es kein Zeichen. */}
              <div className="flex items-center gap-1">
                {/* Zwei Zahlen, die etwas von einem wollen — deshalb stehen sie
                    links von den Werkzeugen und nur bei denen, die sie abtragen
                    können: Meldungen sieht die Plattform-Verwaltung, Maßnahmen,
                    wer sie auch abhaken darf. */}
                {darfMeldungen && <FeedbackGlocke />}
                {darfMassnahmen && <MassnahmenKnopf />}
                <Link href="/hilfe" aria-label={t.kopf.hilfe} title={t.kopf.hilfe} className={KNOPF}>
                  <CircleHelp className="h-[18px] w-[18px]" aria-hidden />
                </Link>
                {/* Sprache, Erscheinungsbild, Einstellungen und Abmelden liegen
                    im Menü hinter den Initialen: selten gebraucht, aber immer da. */}
                <Benutzermenue email={session.email} darfEinstellungen={session.apps.platform === "admin"} />
              </div>
          </header>
          <main className="mx-auto max-w-7xl p-6">{children}</main>
          <MeldeKnopf />
        </div>
      </SprachAnbieter>
    </Providers>
  );
}
