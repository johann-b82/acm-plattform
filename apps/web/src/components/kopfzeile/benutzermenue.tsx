"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Languages, LogOut, Settings, SunMoon } from "lucide-react";

import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ErscheinungsbildUmschalter } from "@/components/erscheinungsbild/umschalter";
import { initialen } from "@/lib/initialen";
import { SPRACHEN, SPRACHE_LABEL } from "@/lib/sprache";
import { setzeSprache } from "@/app/sprache-aktion";
import { signOut } from "@/app/login/actions";

const EINTRAG =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-[var(--muted)] " +
  "focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

/**
 * Das Benutzermenü hinter zwei Initialen (NAV-02).
 *
 * Darin: wer angemeldet ist, die Sprache, die Einstellungen — nur für die
 * Plattform-Verwaltung — und Abmelden. Hilfe und Erscheinungsbild bleiben
 * direkt in der Kopfzeile.
 *
 * Ob jemand die Einstellungen sieht, entscheidet der Server (`darfEinstellungen`
 * aus dem Token). Die Seite prüft das Recht ein zweites Mal, und die
 * Datenbank ein drittes — das Menü verbirgt nur, was ohnehin verweigert würde.
 */
export function Benutzermenue({
  email,
  darfEinstellungen,
}: {
  email: string | null;
  darfEinstellungen: boolean;
}) {
  const t = useTexte();
  const sprache = useSprache();
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, starte] = useTransition();
  const knopf = useRef<HTMLButtonElement>(null);
  const flaeche = useRef<HTMLDivElement>(null);
  const menueId = useId();
  const spracheId = useId();

  useEffect(() => {
    if (!offen) return;
    function aussen(e: PointerEvent) {
      if (!flaeche.current?.contains(e.target as Node) && !knopf.current?.contains(e.target as Node)) {
        setOffen(false);
      }
    }
    document.addEventListener("pointerdown", aussen);
    return () => document.removeEventListener("pointerdown", aussen);
  }, [offen]);

  function schliessen() {
    setOffen(false);
    knopf.current?.focus();
  }

  return (
    <div className="relative">
      <button
        ref={knopf}
        type="button"
        aria-haspopup="true"
        aria-expanded={offen}
        aria-controls={menueId}
        aria-label={t.kopf.benutzermenue}
        title={email ?? t.kopf.benutzermenue}
        onClick={() => setOffen((o) => !o)}
        className={
          "ms-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] " +
          "bg-[var(--muted)] text-xs font-semibold tracking-wide text-[var(--fg)] hover:bg-[var(--border)] " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        }
      >
        {initialen(email)}
      </button>

      {offen && (
        <div
          ref={flaeche}
          id={menueId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              schliessen();
            }
          }}
          className="absolute end-0 top-11 z-50 w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg"
        >
          {email && (
            <div className="border-b border-[var(--border)] px-2 pb-2 text-xs text-[var(--fg-muted)]">
              {t.kopf.angemeldetAls}
              <div className="truncate text-sm text-[var(--fg)]" title={email}>
                {email}
              </div>
            </div>
          )}

          <div className="mt-2 px-2">
            <label htmlFor={spracheId} className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <Languages className="h-4 w-4" aria-hidden />
              {t.kopf.sprache}
            </label>
            <select
              id={spracheId}
              autoFocus
              value={sprache}
              disabled={laeuft}
              onChange={(e) => {
                const gewaehlt = e.target.value;
                starte(async () => {
                  await setzeSprache(gewaehlt);
                  router.refresh();
                });
              }}
              className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
            >
              {SPRACHEN.map((s) => (
                <option key={s} value={s}>
                  {SPRACHE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 px-2">
            <span className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <SunMoon className="h-4 w-4" aria-hidden />
              {t.kopf.erscheinungsbild}
            </span>
            <div className="mt-1">
              <ErscheinungsbildUmschalter />
            </div>
          </div>

          <div className="mt-2 border-t border-[var(--border)] pt-2">
            {darfEinstellungen && (
              <Link href="/einstellungen" className={EINTRAG} onClick={() => setOffen(false)}>
                <Settings className="h-4 w-4 text-[var(--fg-muted)]" aria-hidden />
                {t.kopf.einstellungen}
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className={EINTRAG}>
                <LogOut className="h-4 w-4 text-[var(--fg-muted)]" aria-hidden />
                {t.kopf.abmelden}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
