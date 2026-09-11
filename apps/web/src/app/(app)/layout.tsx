import Link from "next/link";
import { CircleHelp, LogOut, Settings } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { sprache, texte } from "@/lib/sprache-server";
import { hasLevel } from "@/lib/rechte";
import { logoAdresse } from "@/lib/logo-server";
import { signOut } from "@/app/login/actions";
import { Providers } from "@/components/providers";
import { Brotkrumen } from "@/components/brotkrumen";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { SprachUmschalter } from "@/components/sprache/umschalter";
import { KNOPF } from "@/components/kopfzeile/knopf";
import { Seitentitel } from "@/components/kopfzeile/seitentitel";
import { FeedbackGlocke } from "@/components/feedback/glocke";
import { MassnahmenKnopf } from "@/components/kpi/massnahmen-knopf";
import { MeldeKnopf } from "@/components/feedback/melde-knopf";
import { ErscheinungsbildUmschalter } from "@/components/erscheinungsbild/umschalter";

/**
 * Shell für alle angemeldeten Seiten. Läuft immer pro Anfrage (die Sitzung
 * kommt aus Cookies), deshalb werden hier die Laufzeitwerte für den
 * Supabase-Client im Browser gelesen und an die Provider gereicht.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const logo = await logoAdresse();
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
                    alt="ACM"
                    className="h-8 w-auto max-w-44 object-contain"
                  />
                ) : (
                  <span className="font-semibold tracking-tight">ACM-Plattform</span>
                )}
              </Link>
              {/* Der Pfad steht neben dem Logo, nicht über dem Inhalt: oben links
                  fängt das Auge an, und dort steht ohnehin schon der Weg nach
                  Hause. */}
              <Brotkrumen />
            </div>
            {/* Mittig auf der Seite, nicht mittig zwischen den beiden Blöcken:
                sonst wandert der Titel, sobald der Pfad länger wird. Deshalb
                absolut gesetzt und ohne Mausfang — was darunter liegt, bleibt
                anklickbar. */}
            <Seitentitel />
            {/* Zeichen statt Beschriftungen: drei Wörter nebeneinander drängten
                  die Kopfzeile zu, und gemeint ist jedes Mal dasselbe wie das
                  Zeichen. Die Beschriftung bleibt als `aria-label` und als
                  `title` — wer die Maus darüber hält oder einen Screenreader
                  benutzt, bekommt sie. Die Adresse bleibt Text: sie sagt, wer
                  angemeldet ist, und dafür gibt es kein Zeichen. */}
              <div className="flex items-center gap-1">
                <span className="mr-2 hidden text-sm text-[var(--fg-muted)] sm:inline">
                  {session.email}
                </span>
                {/* Zwei Zahlen, die etwas von einem wollen — deshalb stehen sie
                    links von den Werkzeugen und nur bei denen, die sie abtragen
                    können: Meldungen sieht die Plattform-Verwaltung, Maßnahmen,
                    wer sie auch abhaken darf. */}
                {darfMeldungen && <FeedbackGlocke />}
                {darfMassnahmen && <MassnahmenKnopf />}
                <SprachUmschalter />
                <ErscheinungsbildUmschalter />
                <Link href="/hilfe" aria-label={t.kopf.hilfe} title={t.kopf.hilfe} className={KNOPF}>
                  <CircleHelp className="h-[18px] w-[18px]" aria-hidden />
                </Link>
                {session.apps.platform === "admin" && (
                  <Link
                    href="/einstellungen"
                    aria-label={t.kopf.einstellungen}
                    title={t.kopf.einstellungen}
                    className={KNOPF}
                  >
                    <Settings className="h-[18px] w-[18px]" aria-hidden />
                  </Link>
                )}
                <form action={signOut}>
                  <button type="submit" aria-label={t.kopf.abmelden} title={t.kopf.abmelden} className={KNOPF}>
                    <LogOut className="h-[18px] w-[18px]" aria-hidden />
                  </button>
                </form>
              </div>
          </header>
          <main className="mx-auto max-w-7xl p-6">{children}</main>
          <MeldeKnopf />
        </div>
      </SprachAnbieter>
    </Providers>
  );
}
