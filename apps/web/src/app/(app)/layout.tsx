import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { logoAdresse } from "@/lib/logo-server";
import { signOut } from "@/app/login/actions";
import { Providers } from "@/components/providers";
import { MeldeKnopf } from "@/components/feedback/melde-knopf";

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
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--fg-muted)]">{session.email}</span>
            <Link href="/hilfe" className="underline-offset-4 hover:underline">
              Hilfe
            </Link>
            {session.apps.platform === "admin" && (
              <Link href="/einstellungen" className="underline-offset-4 hover:underline">
                Einstellungen
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className="underline-offset-4 hover:underline">
                Abmelden
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
