"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useTexte } from "@/components/sprache/anbieter";

const TABS = [
  { href: "/signage/media", wort: "medien" },
  { href: "/signage/playlists", wort: "playlists" },
  { href: "/signage/schedules", wort: "zeitplaene" },
  { href: "/signage/devices", wort: "geraete" },
] as const;

export function SignageTabs() {
  const worte = useTexte();
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-[var(--border)]" aria-label={worte.signage.bereiche}>
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-[var(--fg)] text-[var(--fg)]"
                : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {worte.signage[tab.wort]}
          </Link>
        );
      })}
    </nav>
  );
}
