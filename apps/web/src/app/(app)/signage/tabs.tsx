"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/signage/media", label: "Medien" },
  { href: "/signage/playlists", label: "Playlists" },
  { href: "/signage/schedules", label: "Zeitpläne" },
  { href: "/signage/devices", label: "Geräte" },
] as const;

export function SignageTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-[var(--border)]" aria-label="Signage-Bereiche">
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
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
