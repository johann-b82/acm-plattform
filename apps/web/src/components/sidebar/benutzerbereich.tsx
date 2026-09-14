"use client";

import { useId, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";

import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ErscheinungsbildUmschalter } from "@/components/erscheinungsbild/umschalter";
import { SPRACHEN, SPRACHE_LABEL } from "@/lib/sprache";
import { setzeSprache } from "@/app/sprache-aktion";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/cn";

const EINTRAG =
  "flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-start text-sm text-[var(--fg-muted)] " +
  "transition-colors hover:bg-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

/**
 * Was früher hinter den Initialen lag (NAV-02), steht unten in der
 * Seitenleiste offen da: wer angemeldet ist, Sprache, Erscheinungsbild, die
 * Einstellungen — nur für die Plattform-Verwaltung — und Abmelden.
 *
 * Eingeklappt bleiben Einstellungen und Abmelden als Zeichen; Sprache und
 * Erscheinungsbild brauchen Platz und stehen nur in der breiten Leiste.
 *
 * Ob jemand die Einstellungen sieht, entscheidet der Server (`darfEinstellungen`
 * aus dem Token). Die Seite prüft das Recht ein zweites Mal, und die
 * Datenbank ein drittes — hier wird nur verborgen, was ohnehin verweigert würde.
 */
export function Benutzerbereich({
  email,
  darfEinstellungen,
  mitText,
  onNavigieren,
}: {
  email: string | null;
  darfEinstellungen: boolean;
  /** Breite Leiste mit Beschriftungen, sonst nur Zeichen. */
  mitText: boolean;
  /** Schließt die Schublade, wenn ein Verweis angeklickt wird. */
  onNavigieren: () => void;
}) {
  const t = useTexte();
  const sprache = useSprache();
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const spracheId = useId();

  return (
    <div className="space-y-2 border-t border-[var(--border)] p-2">
      {mitText && (
        <div className="space-y-2 px-2">
          <div>
            <label htmlFor={spracheId} className="text-xs text-[var(--fg-muted)]">
              {t.kopf.sprache}
            </label>
            <select
              id={spracheId}
              value={sprache}
              disabled={laeuft}
              onChange={(e) => {
                const gewaehlt = e.target.value;
                starte(async () => {
                  await setzeSprache(gewaehlt);
                  router.refresh();
                });
              }}
              className="mt-1 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
            >
              {SPRACHEN.map((s) => (
                <option key={s} value={s}>
                  {SPRACHE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-xs text-[var(--fg-muted)]">{t.kopf.erscheinungsbild}</span>
            <div className="mt-1">
              <ErscheinungsbildUmschalter />
            </div>
          </div>
        </div>
      )}

      {darfEinstellungen && (
        <Link
          href="/einstellungen"
          onClick={onNavigieren}
          title={mitText ? undefined : t.kopf.einstellungen}
          className={cn(EINTRAG, !mitText && "justify-center px-0")}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className={cn("truncate", !mitText && "sr-only")}>{t.kopf.einstellungen}</span>
        </Link>
      )}

      {/* Wer angemeldet ist, steht direkt über „Abmelden“ — beides gehört zum
          Konto, nicht zu den Einstellungen der Oberfläche. */}
      {mitText && email && (
        <div className="min-w-0 px-2 py-1 text-xs text-[var(--fg-muted)]">
          {t.kopf.angemeldetAls}
          <div className="truncate text-sm text-[var(--fg)]" title={email}>
            {email}
          </div>
        </div>
      )}

      <ul className="space-y-0.5">
        <li>
          <form action={signOut}>
            <button
              type="submit"
              title={mitText ? undefined : t.kopf.abmelden}
              className={cn(EINTRAG, !mitText && "justify-center px-0")}
            >
              <LogOut className="h-[18px] w-[18px] shrink-0 rtl:-scale-x-100" aria-hidden />
              <span className={cn("truncate", !mitText && "sr-only")}>{t.kopf.abmelden}</span>
            </button>
          </form>
        </li>
      </ul>
    </div>
  );
}
