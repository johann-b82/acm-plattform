"use client";

import { Input } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";
import type { Zeichnung } from "@/lib/fair";

export type Kopffeld = "kunde" | "artikelnummer" | "teilenummer";

/**
 * Projektkopf über der Zeichnung (FAI-03): Kunde, Artikelnr., P/N.
 *
 * Wie im Altsystem (`FairPage.tsx`, `LabeledField`): kein eigener
 * Bearbeiten-Modus, das Feld speichert beim Verlassen oder mit Enter, und nur,
 * wenn sich der getrimmte Wert geändert hat. Leer heißt „kein Wert“. Wer nur
 * lesen darf, sieht die Werte als Text.
 */
export function Projektkopf({
  werte,
  darfSchreiben,
  onSpeichern,
}: {
  werte: Pick<Zeichnung, Kopffeld>;
  darfSchreiben: boolean;
  onSpeichern: (feld: Kopffeld, wert: string | null) => void;
}) {
  const worte = useTexte().fair;
  const felder: { feld: Kopffeld; titel: string; platzhalter: string; laenge: number }[] = [
    { feld: "kunde", titel: worte.kunde, platzhalter: worte.kunde, laenge: 255 },
    { feld: "artikelnummer", titel: worte.artikelnummer, platzhalter: worte.artikelnummerLang, laenge: 64 },
    { feld: "teilenummer", titel: worte.pn, platzhalter: worte.teilenummer, laenge: 64 },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {felder.map(({ feld, titel, platzhalter, laenge }) => {
        const wert = werte[feld];
        const id = `fair-kopf-${feld}`;
        return (
          <div key={feld} className="flex items-center gap-2">
            <label htmlFor={darfSchreiben ? id : undefined} className="text-sm font-medium text-[var(--fg-muted)]">
              {titel}
            </label>
            {darfSchreiben ? (
              <Input
                id={id}
                // Neuer Wert vom Server → Feld neu aufsetzen; beim Tippen bleibt
                // der Schlüssel gleich und damit der eingegebene Text.
                key={wert ?? ""}
                defaultValue={wert ?? ""}
                placeholder={platzhalter}
                maxLength={laenge}
                className="h-8 w-40"
                onBlur={(e) => {
                  const neu = e.currentTarget.value.trim() || null;
                  if (neu !== (wert ?? null)) onSpeichern(feld, neu);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            ) : (
              <span className="text-sm">{wert || "—"}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
