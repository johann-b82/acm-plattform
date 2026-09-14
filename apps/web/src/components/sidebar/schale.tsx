"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  CircleHelp,
  House,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { useTexte } from "@/components/sprache/anbieter";
import { Brotkrumen } from "@/components/brotkrumen";
import { Benutzerbereich } from "@/components/sidebar/benutzerbereich";
import { KATEGORIEN, Werkzeugplatz, type Kategorie, type Plaetze } from "@/components/sidebar/werkzeugplatz";
import { MeldeKnopf } from "@/components/feedback/melde-knopf";
import { KNOPF } from "@/components/kopfzeile/knopf";
import { setzeSeitenleiste } from "@/app/seitenleiste-aktion";
import { setzeWerkzeugleiste } from "@/app/werkzeugleiste-aktion";
import { symbol } from "@/lib/symbole";
import { cn } from "@/lib/cn";
import type { NavEintrag } from "@/lib/navigation";

const EINTRAG =
  "flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors " +
  "hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

/** Liegt die Adresse auf dieser Seite oder darunter? */
function unter(pfad: string, seite: string): boolean {
  return pfad === seite || pfad.startsWith(`${seite}/`);
}

/**
 * Die Schale aller angemeldeten Seiten: links die Seitenleiste, in der Mitte
 * eine schmale Kopfzeile mit Logo, Pfad und den Zählern über dem Inhalt,
 * rechts die Leiste mit Filtern und Aktionen.
 *
 * Die linke Leiste führt die Apps mit Recht und darunter die Unterseiten ihrer
 * Übersicht; die App der aktuellen Seite ist aufgeklappt. Unten sitzt das
 * Benutzermenü (Sprache, Erscheinungsbild, Einstellungen, Abmelden).
 *
 * Die rechte Leiste nimmt auf, was für die ganze Seite gilt: die Seite stellt
 * es über `Seitenwerkzeuge` hinein (der `Seitenkopf` tut das von selbst).
 * Unten steht „App Feedback melden“ — auch auf Seiten ohne Filter, damit die
 * Leiste nicht zwischen Seiten auftaucht und verschwindet.
 *
 * Beide Leisten sind einklappbar zur Symbolleiste; ob, merken Cookies, die das
 * Layout auf dem Server liest — sonst sprängen sie nach dem Laden. Auf
 * schmalen Bildschirmen sind beide Schubladen hinter Knöpfen in der Kopfzeile.
 */
export function Schale({
  eintraege,
  eingeklappt: anfangsEingeklappt,
  werkzeugeEingeklappt: anfangsWerkzeugeEingeklappt,
  logo,
  appName,
  email,
  darfEinstellungen,
  kopf,
  children,
}: {
  eintraege: NavEintrag[];
  eingeklappt: boolean;
  werkzeugeEingeklappt: boolean;
  logo: string | null;
  appName: string;
  email: string | null;
  darfEinstellungen: boolean;
  /** Was rechts in der Kopfzeile steht: Glocke, Maßnahmen. */
  kopf: ReactNode;
  children: ReactNode;
}) {
  const t = useTexte();
  const pfad = usePathname() ?? "/";
  const [eingeklappt, setEingeklappt] = useState(anfangsEingeklappt);
  const [offen, setOffen] = useState(false);
  const [werkzeugeEingeklappt, setWerkzeugeEingeklappt] = useState(anfangsWerkzeugeEingeklappt);
  const [werkzeugeOffen, setWerkzeugeOffen] = useState(false);
  const [plaetze, setPlaetze] = useState<Plaetze>({});
  // Feste Ref-Rückrufe je Kategorie: ein neuer Rückruf bei jedem Zeichnen
  // hängte den Platz jedes Mal aus und wieder ein.
  const platzRefs = useMemo(
    () =>
      Object.fromEntries(
        KATEGORIEN.map((k) => [
          k,
          (el: HTMLElement | null) => setPlaetze((alt) => (alt[k] === el ? alt : { ...alt, [k]: el })),
        ]),
      ) as Record<Kategorie, (el: HTMLElement | null) => void>,
    [],
  );
  const [aufgeklappt, setAufgeklappt] = useState<Set<string>>(
    () =>
      new Set(
        eintraege
          .filter((e) => unter(pfad, e.pfad) || e.unterseiten.some((u) => unter(pfad, u.pfad)))
          .map((e) => e.pfad),
      ),
  );

  // In der Schublade stehen die Namen immer — dort ist Platz, und eingeklappt
  // gilt nur für die festen Leisten auf breiten Bildschirmen.
  const mitText = !eingeklappt || offen;
  const werkzeugeMitText = !werkzeugeEingeklappt || werkzeugeOffen;

  function umschalten() {
    const neu = !eingeklappt;
    setEingeklappt(neu);
    void setzeSeitenleiste(neu);
  }

  function werkzeugeUmschalten() {
    const neu = !werkzeugeEingeklappt;
    setWerkzeugeEingeklappt(neu);
    void setzeWerkzeugleiste(neu);
  }

  function klappe(app: string) {
    setAufgeklappt((vorher) => {
      const neu = new Set(vorher);
      if (neu.has(app)) neu.delete(app);
      else neu.add(app);
      return neu;
    });
  }

  const schliessen = () => setOffen(false);
  const allesSchliessen = () => {
    setOffen(false);
    setWerkzeugeOffen(false);
  };

  const verweis = (href: string, name: string, zeichen: ReactNode, eingerueckt = false) => (
    <Link
      href={href}
      onClick={schliessen}
      aria-current={pfad === href ? "page" : undefined}
      title={mitText ? undefined : name}
      className={cn(
        EINTRAG,
        eingerueckt && "ps-9",
        pfad === href ? "bg-[var(--muted)] font-medium text-[var(--fg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
        !mitText && "justify-center px-0",
      )}
    >
      {zeichen}
      <span className={cn("min-w-0 truncate", !mitText && "sr-only")}>{name}</span>
    </Link>
  );

  return (
    <Werkzeugplatz.Provider value={plaetze}>
      <div className="flex min-h-screen">
        {(offen || werkzeugeOffen) && (
          <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={allesSchliessen} aria-hidden />
        )}

        <aside
          data-testid="seitenleiste"
          data-offen={offen}
          className={cn(
            "fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-[var(--border)] bg-[var(--surface)] transition-[transform,width]",
            "md:sticky md:top-0 md:h-screen md:translate-x-0",
            offen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
            eingeklappt ? "md:w-16" : "md:w-64",
          )}
        >
          {/* Das Logo steht in der Kopfzeile; hier oben bleibt nur das Ein- und
              Ausklappen (breit) bzw. das Schließen der Schublade (schmal). */}
          <div
            className={cn(
              "flex h-14 items-center justify-end gap-2 border-b border-[var(--border)] px-3",
              !mitText && "md:justify-center md:px-0",
            )}
          >
            <button
              type="button"
              onClick={umschalten}
              aria-label={eingeklappt ? t.kopf.ausklappen : t.kopf.einklappen}
              title={eingeklappt ? t.kopf.ausklappen : t.kopf.einklappen}
              className={cn(KNOPF, "hidden md:inline-flex")}
            >
              {eingeklappt ? (
                <PanelLeftOpen className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />
              ) : (
                <PanelLeftClose className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={schliessen}
              aria-label={t.kopf.navigationSchliessen}
              className={cn(KNOPF, "md:hidden")}
            >
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>

          <nav aria-label={t.kopf.navigation} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            <ul className="space-y-0.5">
              <li className="flex">{verweis("/", t.pfad.start, <House className="h-[18px] w-[18px] shrink-0" aria-hidden />)}</li>
              {eintraege.map((e) => {
                const Zeichen = symbol(e.pfad);
                const auf = aufgeklappt.has(e.pfad);
                return (
                  <li key={e.pfad}>
                    <div className="flex items-center gap-1">
                      {verweis(e.pfad, e.name, <Zeichen className="h-[18px] w-[18px] shrink-0" aria-hidden />)}
                      {mitText && e.unterseiten.length > 0 && (
                        <button
                          type="button"
                          onClick={() => klappe(e.pfad)}
                          aria-expanded={auf}
                          aria-label={auf ? t.kopf.unterseitenVerbergen(e.name) : t.kopf.unterseitenZeigen(e.name)}
                          className={cn(KNOPF, "h-8 w-8 shrink-0")}
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform", !auf && "-rotate-90 rtl:rotate-90")} aria-hidden />
                        </button>
                      )}
                    </div>
                    {mitText && auf && e.unterseiten.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5">
                        {e.unterseiten.map((u) => (
                          <li key={u.pfad} className="flex">
                            {verweis(u.pfad, t.pfad.seiten[u.titelVon as keyof typeof t.pfad.seiten] ?? u.pfad, null, true)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          <Benutzerbereich
            email={email}
            darfEinstellungen={darfEinstellungen}
            mitText={mitText}
            onNavigieren={schliessen}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 md:px-6">
            <button
              type="button"
              onClick={() => setOffen(true)}
              aria-label={t.kopf.navigationOeffnen}
              aria-expanded={offen}
              className={cn(KNOPF, "md:hidden")}
            >
              <Menu className="h-[18px] w-[18px]" aria-hidden />
            </button>
            {/* Oben links fängt das Auge an: dort das Logo als Weg nach Hause,
                rechts daneben der Pfad. */}
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Link href="/" className="flex shrink-0 items-center" aria-label={t.kopf.uebersicht}>
                {logo ? (
                  // Eine signierte Adresse auf eine hochgeladene Datei; `next/image`
                  // bräuchte dafür eine Host-Freigabe und brächte hier nichts.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt={appName} className="h-8 w-auto max-w-44 object-contain" />
                ) : (
                  <span className="font-semibold tracking-tight">{appName}</span>
                )}
              </Link>
              <Brotkrumen />
            </div>
            <div className="flex items-center gap-1">
              {kopf}
              {/* Die Hilfe steht nur hier oben, als Zeichen hinter den Zählern:
                  sie wird mitten in der Arbeit gebraucht, nicht beim Navigieren. */}
              <Link href="/hilfe" aria-label={t.kopf.hilfe} title={t.kopf.hilfe} className={KNOPF}>
                <CircleHelp className="h-[18px] w-[18px]" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => setWerkzeugeOffen(true)}
                aria-label={t.kopf.werkzeugeOeffnen}
                aria-expanded={werkzeugeOffen}
                className={cn(KNOPF, "md:hidden")}
              >
                <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </div>
          </header>
          {/* Höchstens 1600 px: auf großen Bildschirmen nutzen Tabellen und Diagramme
              die Fläche, Texte bleiben lesbar. */}
          <main className="mx-auto w-full max-w-[100rem] p-6">{children}</main>
        </div>

        <aside
          data-testid="werkzeugleiste"
          data-offen={werkzeugeOffen}
          aria-label={t.kopf.werkzeuge}
          className={cn(
            "fixed inset-y-0 end-0 z-40 flex w-72 flex-col border-s border-[var(--border)] bg-[var(--surface)] transition-[transform,width]",
            "md:sticky md:top-0 md:h-screen md:translate-x-0",
            werkzeugeOffen ? "translate-x-0" : "translate-x-full rtl:-translate-x-full",
            werkzeugeEingeklappt ? "md:w-16" : "md:w-72",
          )}
        >
          <div
            className={cn(
              "flex h-14 items-center gap-2 border-b border-[var(--border)] px-3",
              !werkzeugeMitText && "md:justify-center md:px-0",
            )}
          >
            <button
              type="button"
              onClick={werkzeugeUmschalten}
              aria-label={werkzeugeEingeklappt ? t.kopf.werkzeugeAusklappen : t.kopf.werkzeugeEinklappen}
              title={werkzeugeEingeklappt ? t.kopf.werkzeugeAusklappen : t.kopf.werkzeugeEinklappen}
              className={cn(KNOPF, "hidden md:inline-flex")}
            >
              {werkzeugeEingeklappt ? (
                <PanelRightOpen className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />
              ) : (
                <PanelRightClose className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />
              )}
            </button>
            {werkzeugeMitText && <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.kopf.werkzeuge}</span>}
            <button
              type="button"
              onClick={() => setWerkzeugeOffen(false)}
              aria-label={t.kopf.werkzeugeSchliessen}
              className={cn(KNOPF, "md:hidden")}
            >
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>

          {/* Die Plätze bleiben eingehängt, auch eingeklappt: die Filter gehören
              der Seite, und ihr Zustand soll beim Einklappen nicht verloren gehen.
              Je Kategorie ein Abschnitt mit Überschrift und Trennlinie; ein
              Abschnitt, in den keine Seite etwas stellt, ist unsichtbar. */}
          <div className={cn("min-h-0 flex-1 overflow-y-auto", !werkzeugeMitText && "md:hidden")}>
            {KATEGORIEN.map((k) => (
              <section
                key={k}
                aria-label={t.kopf.kategorien[k]}
                className="border-b border-[var(--border)] p-3 has-[>[data-platz]:empty]:hidden"
              >
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                  {t.kopf.kategorien[k]}
                </h3>
                <div data-platz={k} ref={platzRefs[k]} className="flex flex-col items-stretch gap-3" />
              </section>
            ))}
          </div>
          {!werkzeugeMitText && <div className="hidden flex-1 md:block" />}

          <div className={cn("border-t border-[var(--border)] p-3", !werkzeugeMitText && "md:flex md:justify-center md:px-0")}>
            <MeldeKnopf mitText={werkzeugeMitText} />
          </div>
        </aside>
      </div>
    </Werkzeugplatz.Provider>
  );
}
