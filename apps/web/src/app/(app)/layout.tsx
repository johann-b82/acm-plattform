import Link from "next/link";
import { CircleHelp, LogOut, Settings } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { logoAdresse } from "@/lib/logo-server";
import { signOut } from "@/app/login/actions";
import { Providers } from "@/components/providers";
import { MeldeKnopf } from "@/components/feedback/melde-knopf";
import { ErscheinungsbildUmschalter } from "@/components/erscheinungsbild/umschalter";

/** Ein Zeichen in der Kopfzeile: quadratische Fläche, sichtbarer Tastaturfokus. */
const KNOPF =
  "inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-muted)] " +
  "transition-colors hover:bg-[var(--muted)] hover:text-[var(--fg)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

/**
 * Shell für alle angemeldeten Seiten. Läuft immer pro Anfrage (die Sitzung
 * kommt aus Cookies), deshalb werden hier die Laufzeitwerte für den
 * Supabase-Client im Browser gelesen und an die Provider gereicht.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const logo = await logoAdresse();
  return (
    <Providers
      supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!}
      supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}
    >
      <div className="min-h-screen">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
          <Link href="/" className="flex items-center gap-2" aria-label="Zur Übersicht">
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
            <ErscheinungsbildUmschalter />
            <Link href="/hilfe" aria-label="Hilfe" title="Hilfe" className={KNOPF}>
              <CircleHelp className="h-[18px] w-[18px]" aria-hidden />
            </Link>
            {session.apps.platform === "admin" && (
              <Link
                href="/einstellungen"
                aria-label="Einstellungen"
                title="Einstellungen"
                className={KNOPF}
              >
                <Settings className="h-[18px] w-[18px]" aria-hidden />
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" aria-label="Abmelden" title="Abmelden" className={KNOPF}>
                <LogOut className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-6">{children}</main>
        <MeldeKnopf />
      </div>
    </Providers>
  );
}
