import { cookies } from "next/headers";

import { requireSession } from "@/lib/auth";
import { sprache } from "@/lib/sprache-server";
import { hasLevel } from "@/lib/rechte";
import { logoAdresse } from "@/lib/logo-server";
import { ladeErscheinung } from "@/lib/erscheinung-server";
import { navigation, SEITENLEISTE_COOKIE, WERKZEUGLEISTE_COOKIE, type AppZeile } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";
import { oeffentlicheAdresseAusAnfrage } from "@/lib/supabase/oeffentlich";
import { Providers } from "@/components/providers";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Schale } from "@/components/sidebar/schale";
import { FeedbackGlocke } from "@/components/feedback/glocke";
import { SeitenFeedback } from "@/components/feedback/seiten-feedback";
import { MassnahmenKnopf } from "@/components/kpi/massnahmen-knopf";

/**
 * Shell für alle angemeldeten Seiten. Läuft immer pro Anfrage (die Sitzung
 * kommt aus Cookies), deshalb werden hier die Laufzeitwerte für den
 * Supabase-Client im Browser gelesen und an die Provider gereicht. Die Adresse
 * kommt dabei aus der Anfrage selbst (`oeffentlicheAdresseAusAnfrage`) — sonst
 * bekäme ein Browser auf einem anderen Rechner `localhost` und erreichte
 * nichts.
 *
 * Die Navigation steht in der Seitenleiste (`Schale`); welche Apps und
 * Unterseiten dort stehen, rechnet `navigation` aus der Tabelle `apps` und dem
 * Claim `apps` — dieselbe Regel wie auf dem Starter. Filter, Aktionen und
 * „App Feedback melden“ stehen in der rechten Leiste der Schale.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const logo = await logoAdresse();
  const { appName } = await ladeErscheinung();
  const gewaehlt = await sprache();
  const kekse = await cookies();
  const eingeklappt = kekse.get(SEITENLEISTE_COOKIE)?.value === "eingeklappt";
  const werkzeugeEingeklappt = kekse.get(WERKZEUGLEISTE_COOKIE)?.value === "eingeklappt";
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
      supabaseUrl={await oeffentlicheAdresseAusAnfrage()}
      supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}
    >
      <SprachAnbieter sprache={gewaehlt}>
        <Schale
          eintraege={eintraege}
          eingeklappt={eingeklappt}
          werkzeugeEingeklappt={werkzeugeEingeklappt}
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
          feedback={darfMeldungen ? <SeitenFeedback /> : undefined}
        >
          {children}
        </Schale>
      </SprachAnbieter>
    </Providers>
  );
}
