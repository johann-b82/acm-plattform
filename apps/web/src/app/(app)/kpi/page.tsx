import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { seitentitel, texte } from "@/lib/sprache-server";
import { Card } from "@/components/ui/primitives";
import { Seitenkopf } from "@/components/seitenkopf";

export const generateMetadata = () => seitentitel((t) => t.kennzahlenHub.titel);

/** Die Fachbereiche des KPI-Dashboards. Name und Beschreibung stehen im
 *  Wörterbuch: der Name ist derselbe wie im Pfad, damit ein Verweis und die
 *  Überschrift dahinter nicht verschieden heißen. */
const BEREICHE = [
  { path: "/kpi/vertrieb", schluessel: "vertrieb", bereit: true },
  { path: "/hr", schluessel: "personal", bereit: true },
  { path: "/kpi/qualitaet", schluessel: "qualitaet", bereit: true },
  { path: "/kpi/finanzen", schluessel: "finanzen", bereit: true },
  { path: "/kpi/einkauf", schluessel: "einkauf", bereit: true },
  { path: "/kpi/produktion", schluessel: "produktion", bereit: true },
  { path: "/kpi/bewertung", schluessel: "bewertung", bereit: true },
] as const;

export default async function KpiHubPage() {
  await requireApp("kpi");
  const t = await texte();
  const name: Record<(typeof BEREICHE)[number]["schluessel"], string> = {
    vertrieb: t.pfad.seiten["/kpi/vertrieb"],
    personal: t.pfad.seiten["/hr"],
    qualitaet: t.pfad.seiten["/kpi/qualitaet"],
    finanzen: t.pfad.seiten["/kpi/finanzen"],
    einkauf: t.pfad.seiten["/kpi/einkauf"],
    produktion: t.pfad.seiten["/kpi/produktion"],
    bewertung: t.pfad.seiten["/kpi/bewertung"],
  };
  return (
    <div className="space-y-6">
      <Seitenkopf untertitel={t.kennzahlenHub.einleitung} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BEREICHE.map((b) =>
          b.bereit ? (
            <li key={b.path}>
              <Link
                href={b.path}
                className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--fg-muted)]"
              >
                <div className="font-medium">{name[b.schluessel]}</div>
                <div className="mt-1 text-sm text-[var(--fg-muted)]">{t.kennzahlenHub.bereiche[b.schluessel]}</div>
              </Link>
            </li>
          ) : (
            <li key={b.path}>
              <Card className="p-4 opacity-60">
                <div className="font-medium">{name[b.schluessel]}</div>
                <div className="mt-1 text-sm text-[var(--fg-muted)]">{t.kennzahlenHub.bereiche[b.schluessel]}</div>
                <div className="mt-2 text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                  {t.kennzahlenHub.nochNicht}
                </div>
              </Card>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
