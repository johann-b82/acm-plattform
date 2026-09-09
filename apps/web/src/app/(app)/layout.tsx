import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { Providers } from "@/components/providers";

/**
 * Shell für alle angemeldeten Seiten. Läuft immer pro Anfrage (die Sitzung
 * kommt aus Cookies), deshalb werden hier die Laufzeitwerte für den
 * Supabase-Client im Browser gelesen und an die Provider gereicht.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <Providers
      supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!}
      supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}
    >
      <div className="min-h-screen">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            ACM-Plattform
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--fg-muted)]">{session.email}</span>
            {session.apps.platform === "admin" && (
              <Link href="/platform" className="underline-offset-4 hover:underline">
                Verwaltung
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
      </div>
    </Providers>
  );
}
