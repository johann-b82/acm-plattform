import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { requireSession } from "@/lib/auth";
import { ALLE, finde } from "@/hilfe/registry";
import { texte } from "@/lib/sprache-server";
import { Artikelnavigation } from "@/components/hilfe/artikelnavigation";

export function generateStaticParams() {
  return ALLE.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const treffer = finde(slug);
  return { title: treffer ? `${treffer.seite.titel} · Hilfe` : "Hilfe · ACM-Plattform" };
}

/**
 * Eine Hilfeseite.
 *
 * Der Text steht als Markdown in einem Modul und wird hier gesetzt. Rohes HTML
 * rendert `react-markdown` nicht — die Hilfe ist ein Text, kein Baukasten.
 */
export default async function HilfeSeite({ params }: { params: Promise<{ slug: string }> }) {
  await requireSession();
  const t = await texte();
  const { slug } = await params;
  const treffer = finde(slug);
  if (!treffer) notFound();
  const { seite, gruppe } = treffer;

  const geschwister = gruppe.seiten;
  const stelle = geschwister.findIndex((s) => s.slug === seite.slug);
  const vorher = stelle > 0 ? geschwister[stelle - 1] : null;
  const nachher = stelle < geschwister.length - 1 ? geschwister[stelle + 1] : null;

  return (
    // Die Artikelnavigation zeichnet sich in der Schale in die rechte Leiste;
    // der Inhalt hat die Breite deshalb allein.
    <div className="space-y-6">
      <Artikelnavigation
        aktuell={seite.slug}
        beschriftung={{ navigation: t.hilfe.navigation, alleThemen: t.hilfe.alleThemen }}
      />

      <article className="prose-hilfe min-w-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{seite.text}</ReactMarkdown>

        <div className="mt-10 flex flex-wrap justify-between gap-4 border-t border-[var(--border)] pt-4 text-sm">
          {vorher ? (
            <Link href={`/hilfe/${vorher.slug}`} className="underline-offset-4 hover:underline">
              ← {vorher.titel}
            </Link>
          ) : (
            <span />
          )}
          {nachher && (
            <Link href={`/hilfe/${nachher.slug}`} className="underline-offset-4 hover:underline">
              {nachher.titel} →
            </Link>
          )}
        </div>
      </article>
    </div>
  );
}
