import { levelFor, requireSession } from "@/lib/auth";
import { Kacheln } from "@/components/kacheln";
import { texte } from "@/lib/sprache-server";
import { createClient } from "@/lib/supabase/server";

type App = { id: string; name: string; path: string; sort: number };

export default async function LauncherPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await requireSession();
  const { denied } = await searchParams;
  const t = await texte();
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
  // Die Stufe steht auf der Kachel — in der Sprache der Oberfläche, nicht als
  // Schlüssel aus dem Token.
  const stufe = (l: string | null) =>
    l && l in t.zugaenge.stufen ? t.zugaenge.stufen[l as keyof typeof t.zugaenge.stufen] : undefined;

  return (
    <div>
      {denied && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {t.start.verweigert(denied)}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="mt-6 text-[var(--fg-muted)]">
          {t.start.keineApp}
        </p>
      ) : (
        <div className="mt-6">
          <Kacheln
            eintraege={visible.map((a) => ({
              pfad: a.path,
              name: a.name,
              marke: stufe(levelFor(session.apps, a.id)),
            }))}
          />
        </div>
      )}
    </div>
  );
}
