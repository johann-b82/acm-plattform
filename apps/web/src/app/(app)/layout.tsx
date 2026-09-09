import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <Link href="/" className="font-semibold tracking-tight">
          ACM-Plattform
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-500">{session.email}</span>
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
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
