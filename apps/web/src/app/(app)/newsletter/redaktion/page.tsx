import { requireApp } from "@/lib/auth";
import { levelFor } from "@/lib/rechte";
import { Redaktion } from "./redaktion";

export const metadata = { title: "Redaktion · ACM-Plattform" };

export default async function RedaktionPage() {
  const session = await requireApp("newsletter", "editor");
  // Einfrieren verlangt zusätzlich das Recht an der Quelle. Die Funktionen in
  // der Datenbank prüfen es selbst; die Oberfläche sagt vorher, woran es liegt.
  return (
    <Redaktion
      darfKpi={levelFor(session.apps, "kpi") !== null}
      darfHr={levelFor(session.apps, "hr") !== null}
    />
  );
}
