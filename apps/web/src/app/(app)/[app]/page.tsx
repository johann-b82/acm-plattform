import { notFound } from "next/navigation";
import { levelFor, requireApp } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Platzhalter je App, bis die Module in Phase 4 einziehen. Prüft die
 * Berechtigung über die Data-Access-Schicht, nicht über den Proxy.
 */
export default async function AppPage({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("apps").select("id,name").eq("id", app).maybeSingle();
  if (!data) notFound();
  const session = await requireApp(app);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
      <p className="mt-2 text-[var(--fg-muted)]">
        Dein Level: <span className="font-mono">{levelFor(session.apps, app)}</span>. Das Modul zieht in
        Phase 4 aus <span className="font-mono">lumeapps</span> hierher um.
      </p>
    </div>
  );
}
