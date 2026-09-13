import { LoginForm } from "./login-form";
import { seitentitel, texte } from "@/lib/sprache-server";
import { ladeErscheinung } from "@/lib/erscheinung-server";
import { computeServerFetch } from "@/lib/compute-server";

export const generateMetadata = () => seitentitel((t) => t.titel.anmelden);

/** Ist die AD-Anmeldung eingerichtet? Fällt bei jedem Fehler auf „nein" zurück,
 *  damit die Anmeldeseite auch ohne erreichbares compute die lokale Maske zeigt. */
async function adAktiv(): Promise<boolean> {
  try {
    const antwort = await computeServerFetch("/api/anmeldung/ad/status");
    if (!antwort.ok) return false;
    const { aktiv } = await antwort.json();
    return Boolean(aktiv);
  } catch {
    return false;
  }
}

export default async function LoginPage() {
  const t = await texte();
  // Der Name der Plattform ist konfigurierbar (SET-06); die Anmeldeseite zeigt
  // ihn statt eines festen Titels.
  const { appName } = await ladeErscheinung();
  const ad = await adAktiv();
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">{appName}</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">{t.anmeldung.aufforderung}</p>
        <LoginForm texte={t.anmeldung} adAktiv={ad} />
      </div>
    </main>
  );
}
