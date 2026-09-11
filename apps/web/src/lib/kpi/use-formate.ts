"use client";

import { useMemo } from "react";

import { useSprache } from "@/components/sprache/anbieter";
import { formate, type Formate } from "@/lib/kpi/gemeinsam";
import { ZAHL_TAG } from "@/lib/sprache";

/**
 * Die Zahlenformate der gewählten Sprache.
 *
 * Heißt in den Dashboards weiterhin `fmt`, damit an den tausend Aufrufstellen
 * nichts zu ändern war — nur die Herkunft ist eine andere.
 */
export function useFormate(): Formate {
  const sprache = useSprache();
  return useMemo(() => formate(ZAHL_TAG[sprache]), [sprache]);
}
