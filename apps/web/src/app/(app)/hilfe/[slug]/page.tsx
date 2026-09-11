import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { requireSession } from "@/lib/auth";
import { ALLE, finde } from "@/hilfe/registry";
import { texte } from "@/lib/sprache-server";

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
    <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav
        aria-label={gruppe.titel}
        className="self-start text-sm lg:sticky lg:top-6 lg:border-s lg:border-[var(--border)]"
      >
        <p className="mb-2 font-medium lg:ps-3">{gruppe.titel}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:flex-col lg:gap-0">
          {geschwister.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/hilfe/${s.slug}`}
                aria-current={s.slug === seite.slug ? "page" : undefined}
                className={
                  "block py-1 underline-offset-4 hover:underline lg:-ms-px lg:border-s lg:ps-3 " +
                  (s.slug === seite.slug
                    ? "border-[var(--fg)] font-medium lg:border-s"
                    : "border-transparent text-[var(--fg-muted)] lg:border-s")
                }
              >
                {s.titel}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/hilfe"
          className="mt-3 block py-1 text-[var(--fg-muted)] underline-offset-4 hover:underline lg:ps-3"
        >
          {t.hilfe.alleThemen}
        </Link>
      </nav>

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
