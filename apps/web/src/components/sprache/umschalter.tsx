"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";

import { KNOPF } from "@/components/kopfzeile/knopf";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { SPRACHEN, SPRACHE_LABEL } from "@/lib/sprache";
import { setzeSprache } from "@/app/sprache-aktion";

/**
 * Die Sprachwahl in der Kopfzeile.
 *
 * Ein `<select>` und kein eigenes Menü: bei zwei bis fünf Sprachen ist das
 * Eingebaute besser bedienbar als alles Nachgebaute — mit Tastatur, auf dem
 * Telefon und mit Screenreader.
 *
 * Gewählt wird über eine Server-Aktion, die den Cookie setzt; danach lädt die
 * Seite mit `router.refresh()` neu. Der Cookie allein reichte nicht: die
 * Seiten sind schon gesetzt, als der Browser ihn schreibt.
 */
export function SprachUmschalter() {
  const t = useTexte();
  const aktuell = useSprache();
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  return (
    <label className={`${KNOPF} relative w-auto px-1`} title={t.kopf.sprache}>
      <Languages className="h-[18px] w-[18px]" aria-hidden />
      <span className="sr-only">{t.kopf.sprache}</span>
      <select
        aria-label={t.kopf.sprache}
        value={aktuell}
        disabled={laeuft}
        onChange={(e) => {
          const gewaehlt = e.target.value;
          starte(async () => {
            await setzeSprache(gewaehlt);
            router.refresh();
          });
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {SPRACHEN.map((s) => (
          <option key={s} value={s}>
            {SPRACHE_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
