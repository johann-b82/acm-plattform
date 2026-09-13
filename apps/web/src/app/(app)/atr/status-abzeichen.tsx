"use client";

import { useTexte } from "@/components/sprache/anbieter";
import { Badge } from "@/components/ui/primitives";
import type { LieferungStatus } from "@/lib/atr";

/** Die Zustände des Altsystems: draft, generated, delivered (ATR-09). */
export function useStatusText() {
  const worte = useTexte();
  return (status: LieferungStatus) =>
    status === "entwurf"
      ? worte.lieferungen.entwurf
      : status === "erzeugt"
        ? worte.lieferungen.erzeugt
        : worte.lieferungen.abgelegt;
}

export function StatusAbzeichen({ status }: { status: LieferungStatus }) {
  const text = useStatusText();
  return (
    <Badge variant={status === "entwurf" ? "outline" : status === "erzeugt" ? "secondary" : "default"}>
      {text(status)}
    </Badge>
  );
}
