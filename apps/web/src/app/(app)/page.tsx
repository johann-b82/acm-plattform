import Link from "next/link";
import { levelFor, requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type App = { id: string; name: string; path: string; sort: number };

export default async function LauncherPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await requireSession();
  const { denied } = await searchParams;
  const supabase = await createClient();
  // RLS: `apps` ist für alle Eingeloggten lesbar; die Sichtbarkeit je Kachel
  // kommt aus dem Claim `apps`, den der Token-Hook aus app_grants berechnet.
  const { data, error } = await supabase.from("apps").select("id,name,path,sort").order("sort");
  if (error) throw new Error("Apps konnten nicht geladen werden.");
  // `platform` und `settings` sind keine Apps, sondern Querschnitt: beide
  // hängen als „Einstellungen“ in der Kopfzeile und stehen jeder Person
  // offen — was drinsteht, entscheidet dort das Recht je Gruppe.
  const quer = ["platform", "settings"];
  const visible = (data as App[]).filter(
    (a) => !quer.includes(a.id) && levelFor(session.apps, a.id),
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
      {denied && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          Für „{denied}“ hast du keine Berechtigung.
        </p>
      )}
      {visible.length === 0 ? (
        <p className="mt-6 text-[var(--fg-muted)]">
          Deinem Konto ist noch keine App zugewiesen. Bitte an die Plattform-Verwaltung wenden.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((a) => (
            <li key={a.id}>
              <Link
                href={a.path}
                className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--fg-muted)]"
              >
                <div className="font-medium">{a.name}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                  {levelFor(session.apps, a.id)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
