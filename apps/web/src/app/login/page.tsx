import { LoginForm } from "./login-form";
import { seitentitel, texte } from "@/lib/sprache-server";

export const generateMetadata = () => seitentitel((t) => t.titel.anmelden);

export default async function LoginPage() {
  const t = await texte();
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">{t.anmeldung.titel}</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">{t.anmeldung.aufforderung}</p>
        <LoginForm texte={t.anmeldung} />
      </div>
    </main>
  );
}
