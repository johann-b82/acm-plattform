import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { Card } from "@/components/ui/primitives";

export const metadata = { title: "KPI-Dashboard · ACM-Plattform" };

/** Die Fachbereiche des KPI-Dashboards. Nur HR fehlt noch; der Rest ist portiert und folgt
 *  nach demselben Muster (Ingestion in compute, Rechnung als SQL-Funktion). */
const BEREICHE = [
  { path: "/kpi/vertrieb", name: "Vertrieb", beschreibung: "Umsatz, Auftragswert, Kundenanteil", bereit: true },
  { path: "/kpi/hr", name: "HR", beschreibung: "Belegschaft, Fluktuation, Krankenstand", bereit: false },
  { path: "/kpi/qualitaet", name: "Qualität", beschreibung: "Audit-Findings und Reklamationsquote", bereit: true },
  { path: "/kpi/finanzen", name: "Finanzen", beschreibung: "Materialkostenquote; Personalkosten mit HR", bereit: true },
  { path: "/kpi/einkauf", name: "Einkauf", beschreibung: "Liefertermintreue der Lieferanten", bereit: true },
  { path: "/kpi/produktion", name: "Produktion", beschreibung: "Verzug, überfällige Aufträge", bereit: true },
] as const;

export default async function KpiHubPage() {
  await requireApp("kpi");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">KPI-Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Kennzahlen je Fachbereich. Die Daten kommen aus den ERP-Exporten unter Uploads.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BEREICHE.map((b) =>
          b.bereit ? (
            <li key={b.path}>
              <Link
                href={b.path}
                className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--fg-muted)]"
              >
                <div className="font-medium">{b.name}</div>
                <div className="mt-1 text-sm text-[var(--fg-muted)]">{b.beschreibung}</div>
              </Link>
            </li>
          ) : (
            <li key={b.path}>
              <Card className="p-4 opacity-60">
                <div className="font-medium">{b.name}</div>
                <div className="mt-1 text-sm text-[var(--fg-muted)]">{b.beschreibung}</div>
                <div className="mt-2 text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                  noch nicht übernommen
                </div>
              </Card>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
