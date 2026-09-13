"use client";

import { useRouter } from "next/navigation";

import { useTexte } from "@/components/sprache/anbieter";
import { Select } from "@/components/ui/primitives";

/**
 * Welche Ansicht von ATR offen ist (ATR-10). Wie im Altsystem ein Dropdown
 * statt zweier Verweise: `/atr` sind die Lieferungen — dort landet, wer die
 * Kachel öffnet —, `/atr/teilekatalog` der Katalog.
 */
export function Bereichswahl({ aktiv }: { aktiv: "lieferungen" | "teilekatalog" }) {
  const worte = useTexte();
  const router = useRouter();
  return (
    <Select
      aria-label={worte.atr.bereich}
      className="w-auto min-w-44"
      value={aktiv === "lieferungen" ? "/atr" : "/atr/teilekatalog"}
      onChange={(e) => router.push(e.target.value)}
    >
      <option value="/atr">{worte.atr.lieferungen}</option>
      <option value="/atr/teilekatalog">{worte.atr.teilekatalog}</option>
    </Select>
  );
}
