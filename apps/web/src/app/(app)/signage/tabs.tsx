"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge, useInSchale } from "@/components/sidebar/werkzeugplatz";

const TABS = [
  { href: "/signage/media", wort: "medien" },
  { href: "/signage/playlists", wort: "playlists" },
  { href: "/signage/schedules", wort: "zeitplaene" },
  { href: "/signage/devices", wort: "geraete" },
] as const;

/**
 * Die Bereiche von Signage. In der Schale stehen sie als senkrechte Liste in
 * der rechten Leiste; ohne Schale als Reiter über dem Inhalt.
 */
export function SignageTabs() {
  const worte = useTexte();
  const pathname = usePathname();
  const inSchale = useInSchale();
  return (
    <Seitenwerkzeuge kategorie="navigation">
      <nav
        className={inSchale ? "flex flex-col items-stretch gap-1" : "flex gap-1 border-b border-[var(--border)]"}
        aria-label={worte.signage.bereiche}
      >
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-3 py-2 text-sm font-medium transition-colors",
                inSchale
                  ? active
                    ? "rounded-md bg-[var(--muted)] text-[var(--fg)]"
                    : "rounded-md text-[var(--fg-muted)] hover:text-[var(--fg)]"
                  : active
                    ? "-mb-px border-b-2 border-[var(--fg)] text-[var(--fg)]"
                    : "-mb-px border-b-2 border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              {worte.signage[tab.wort]}
            </Link>
          );
        })}
      </nav>
    </Seitenwerkzeuge>
  );
}
