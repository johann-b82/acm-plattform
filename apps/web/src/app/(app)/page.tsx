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
  const visible = (data as App[]).filter((a) => a.id !== "platform" && levelFor(session.apps, a.id));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
      {denied && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          Für „{denied}“ hast du keine Berechtigung.
        </p>
      )}
      {visible.length === 0 ? (
        <p className="mt-6 text-zinc-500">
          Deinem Konto ist noch keine App zugewiesen. Bitte an die Plattform-Verwaltung wenden.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((a) => (
            <li key={a.id}>
              <Link
                href={a.path}
                className="block rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <div className="font-medium">{a.name}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
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
