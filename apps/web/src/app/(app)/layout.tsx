import { cookies } from "next/headers";

import { requireSession } from "@/lib/auth";
import { sprache } from "@/lib/sprache-server";
import { hasLevel } from "@/lib/rechte";
import { logoAdresse } from "@/lib/logo-server";
import { ladeErscheinung } from "@/lib/erscheinung-server";
import { navigation, SEITENLEISTE_COOKIE, type AppZeile } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";
import { Providers } from "@/components/providers";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Schale } from "@/components/sidebar/schale";
import { FeedbackGlocke } from "@/components/feedback/glocke";
import { MassnahmenKnopf } from "@/components/kpi/massnahmen-knopf";
import { MeldeKnopf } from "@/components/feedback/melde-knopf";

/**
 * Shell für alle angemeldeten Seiten. Läuft immer pro Anfrage (die Sitzung
 * kommt aus Cookies), deshalb werden hier die Laufzeitwerte für den
 * Supabase-Client im Browser gelesen und an die Provider gereicht.
 *
 * Die Navigation steht in der Seitenleiste (`Schale`); welche Apps und
 * Unterseiten dort stehen, rechnet `navigation` aus der Tabelle `apps` und dem
 * Claim `apps` — dieselbe Regel wie auf dem Starter.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const logo = await logoAdresse();
  const { appName } = await ladeErscheinung();
  const gewaehlt = await sprache();
  const eingeklappt = (await cookies()).get(SEITENLEISTE_COOKIE)?.value === "eingeklappt";
  // RLS: `apps` ist für alle Eingeloggten lesbar; die Sichtbarkeit kommt aus
  // dem Claim. Fehlt die Tabelle, bleibt die Leiste ohne Apps — die Seite
  // selbst soll daran nicht scheitern.
  const { data } = await (await createClient()).from("apps").select("id,name,path,sort").order("sort");
  const eintraege = navigation((data ?? []) as AppZeile[], session.apps);
  const darfMeldungen = session.apps.platform === "admin";
  // Wer eine Maßnahme abhaken darf, ist derselbe Kreis wie bei den Zielwerten.
  const darfMassnahmen = hasLevel(session.apps, "settings", "editor");
  return (
    <Providers
      supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!}
      supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}
    >
      <SprachAnbieter sprache={gewaehlt}>
        <Schale
          eintraege={eintraege}
          eingeklappt={eingeklappt}
          logo={logo}
          appName={appName}
          email={session.email}
          darfEinstellungen={session.apps.platform === "admin"}
          kopf={
            // Zwei Zahlen, die etwas von einem wollen — nur bei denen, die sie
            // abtragen können: App Feedback sieht die Plattform-Verwaltung,
            // Maßnahmen, wer sie auch abhaken darf.
            <>
              {darfMeldungen && <FeedbackGlocke />}
              {darfMassnahmen && <MassnahmenKnopf />}
            </>
          }
        >
          {children}
        </Schale>
        <MeldeKnopf />
      </SprachAnbieter>
    </Providers>
  );
}
