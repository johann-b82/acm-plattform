import { hasLevel, levelFor, requireSession } from "@/lib/auth";
import { BubbleEbene } from "@/components/kpi/bubble-ebene";

/**
 * Die HR-Kennzahlen liegen unter `/hr`, gehören für die Bubbles aber zu den
 * Dashboards wie Vertrieb oder Einkauf (MAS-01). Bubbles lesen darf, wer
 * `kpi` hat — dieselbe Regel wie auf allen anderen Dashboards.
 */
export default async function HrKennzahlenLayout({ children }: { children: React.ReactNode }) {
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
