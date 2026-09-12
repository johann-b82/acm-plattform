import { hasLevel, levelFor, requireSession } from "@/lib/auth";
import { BubbleEbene } from "@/components/kpi/bubble-ebene";

/**
 * Die Kennzahlen-Seiten tragen die Bubble-Ebene (MAS-01). Sie greift nur auf
 * den Dashboard-Seiten der Bereiche; auf der Übersicht und der Bewertung
 * selbst reicht sie den Inhalt unverändert durch.
 */
export default async function KpiLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <BubbleEbene
      darfLesen={levelFor(session.apps, "kpi") !== null}
      darfSchreiben={hasLevel(session.apps, "settings", "editor")}
    >
      {children}
    </BubbleEbene>
  );
}
