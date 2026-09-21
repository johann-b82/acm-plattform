"use client";

import { useEffect, useRef } from "react";
import { Loader2, Ruler, Type } from "lucide-react";

import { Button, Input } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Das schwebende Wertfeld, das nach dem Markieren über der Stelle erscheint
 * (nachgebaut nach dem Altsystem, `OcrCorrectionInput.tsx`).
 *
 * Es zeigt die OCR-Vermutung, gleich ausgewählt zum Übertippen, und ist
 * editierbar. Zwei Knöpfe lesen dieselbe Stelle neu — als „Maß" (nur Ziffern
 * und Maß-Zeichen) oder als „Text". Es gibt keinen Bestätigen-Schritt: der
 * nächste Klick auf die Zeichnung setzt die Blase und übernimmt den Wert.
 * Escape bricht ab.
 */
export function OcrKorrektur({
  x,
  y,
  wert,
  liest,
  prueftNeu,
  onWert,
  onNeuLesen,
  onAbbrechen,
}: {
  x: number;
  y: number;
  wert: string;
  liest: boolean;
  prueftNeu: boolean;
  onWert: (v: string) => void;
  onNeuLesen: (modus: "mass" | "text") => void;
  onAbbrechen: () => void;
}) {
  const worte = useTexte();
  const feld = useRef<HTMLInputElement>(null);

  // Sobald die erste Lesung da ist: fokussieren und markieren, damit man den
  // Wert sofort übertippen oder bestätigen kann.
  useEffect(() => {
    if (!liest && feld.current) {
      feld.current.focus();
      feld.current.select();
    }
  }, [liest]);

  const gesperrt = liest || prueftNeu;

  return (
    <div
      className="absolute z-20 flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-lg"
      style={{ left: x, top: y, transform: "translate(-50%, 8px)" }}
      // Ein Klick in die Box darf keine Blase setzen und kein neues Feld ziehen.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        <Input
          ref={feld}
          value={wert}
          disabled={liest}
          placeholder={liest ? worte.fair.liest : worte.fair.wert}
          className="h-8 w-44"
          onChange={(e) => onWert(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onAbbrechen();
            }
          }}
        />
        {gesperrt && <Loader2 className="h-4 w-4 animate-spin text-[var(--fg-muted)]" />}
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          className="h-7 flex-1"
          disabled={gesperrt}
          onClick={() => onNeuLesen("mass")}
          title={worte.fair.mass}
        >
          <Ruler className="h-3.5 w-3.5" />
          <span className="ms-1">{worte.fair.mass}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-7 flex-1"
          disabled={gesperrt}
          onClick={() => onNeuLesen("text")}
          title={worte.fair.alsText}
        >
          <Type className="h-3.5 w-3.5" />
          <span className="ms-1">{worte.fair.alsText}</span>
        </Button>
      </div>
    </div>
  );
}
