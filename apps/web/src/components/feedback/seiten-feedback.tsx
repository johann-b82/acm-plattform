"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { feedbackApi, feedbackKeys, type FeedbackStatus } from "@/lib/feedback";
import { ZAHL_TAG } from "@/lib/sprache";
import { useLiveTabellen } from "@/components/realtime/live";

/** Eine neue Meldung zur Seite erscheint ohne Neuladen (ADR-0006). */
const LIVE_TABELLEN = ["feedback"];

/**
 * App Feedback zur aktuellen Seite, in der rechten Leiste: was hier gemeldet
 * und noch nicht erledigt ist. Jeder Eintrag führt zur Liste, dort wird er
 * bearbeitet — die Leiste zeigt nur.
 *
 * Nur für die Plattform-Verwaltung; das Layout hängt die Komponente sonst gar
 * nicht erst ein, und die Leseregel auf `feedback` gäbe ohnehin nichts heraus.
 * Ist zur Seite nichts offen, bleibt der Abschnitt weg.
 */
export function SeitenFeedback() {
  const t = useTexte();
  const w = t.meldungen;
  const pfad = usePathname() ?? "/";
  useLiveTabellen(LIVE_TABELLEN);
  const format = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "short", timeStyle: "short" });
  const { data: meldungen = [] } = useQuery({
    queryKey: feedbackKeys.seite(pfad),
    queryFn: () => feedbackApi.zurSeite(pfad),
    refetchOnWindowFocus: true,
  });
  const { data: konten = [] } = useQuery({
    queryKey: feedbackKeys.konten(),
    queryFn: feedbackApi.konten,
    enabled: meldungen.some((m) => m.zugewiesen),
  });

  if (meldungen.length === 0) return null;

  const statusName: Record<FeedbackStatus, string> = {
    neu: w.offen,
    in_bearbeitung: w.inBearbeitung,
    erledigt: w.erledigt,
  };
  const emailVon = new Map(konten.map((k) => [k.id, k.email]));

  return (
    <section aria-labelledby="seiten-feedback" className="border-b border-[var(--border)] p-3">
      <h3 id="seiten-feedback" className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
        {w.zuDieserSeite}
      </h3>
      <ul className="space-y-1">
        {meldungen.map((m) => (
          <li key={m.id}>
            <Link
              href="/platform/feedback"
              className="block rounded-md px-2 py-1.5 text-sm hover:bg-[var(--muted)]"
            >
              <span className="line-clamp-2">{m.beschreibung}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-[var(--fg-muted)]">
                <span>{statusName[m.status]}</span>
                <span className="truncate">
                  {m.zugewiesen ? (emailVon.get(m.zugewiesen) ?? "…") : w.nichtZugewiesen}
                </span>
                <span>{format.format(new Date(m.erstellt_am))}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
