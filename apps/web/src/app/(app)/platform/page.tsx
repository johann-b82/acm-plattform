import { requireApp } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Group = {
  id: string;
  name: string;
  source: "manual" | "ad";
  app_grants: { app_id: string; level: string }[];
  user_groups: { user_id: string }[];
};

/** Nur-Lese-Ansicht des Rechtemodells; die Pflege folgt mit dem Verwaltungs-Modul. */
export default async function PlatformPage() {
  await requireApp("platform", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .select("id,name,source,app_grants(app_id,level),user_groups(user_id)")
    .order("name");
  if (error) throw new Error("Gruppen konnten nicht geladen werden: " + error.message);
  const groups = data as Group[];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Plattform-Verwaltung</h1>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">
        Gruppen, Mitglieder und App-Rechte. Quelle „ad“ wird später vom Verzeichnis-Sync gefüllt.
      </p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Gruppe</th>
              <th className="px-3 py-2 font-medium">Quelle</th>
              <th className="px-3 py-2 font-medium">Mitglieder</th>
              <th className="px-3 py-2 font-medium">Rechte</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{g.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{g.source}</td>
                <td className="px-3 py-2 tabular-nums">{g.user_groups.length}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {g.app_grants.map((x) => `${x.app_id}:${x.level}`).join(", ") || "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
