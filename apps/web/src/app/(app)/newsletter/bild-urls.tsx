"use client";

import { useQuery } from "@tanstack/react-query";

import { newsletterApi, type Ausgabe, type Kapitel } from "@/lib/newsletter";

/**
 * Signierte URLs für alle Bilder einer Ausgabe, in einem Zug.
 *
 * Der Eimer ist nicht öffentlich, jedes Bild braucht also eine signierte URL.
 * Einzeln wäre das eine Anfrage je Bild, und eine Ausgabe hat leicht zwanzig —
 * `createSignedUrls` erledigt alle mit einer.
 */
export function useBildUrls(
  ausgabe: Ausgabe | undefined,
  kapitel: Kapitel[] | undefined,
): Record<string, string> {
  const pfade: string[] = [];
  if (ausgabe?.titelbild) pfade.push(ausgabe.titelbild);
  if (ausgabe?.rueckseite) pfade.push(ausgabe.rueckseite);
  for (const k of kapitel ?? []) {
    for (const e of k.newsletter_eintrag) {
      for (const b of e.newsletter_bild) pfade.push(b.pfad);
    }
  }
  pfade.sort();

  const { data } = useQuery({
    // Der Schlüssel ist die Menge der Pfade: kommt ein Bild dazu, wird neu
    // signiert; ändert sich nur der Text eines Eintrags, nicht.
    queryKey: ["newsletter", "bild-urls", pfade.join("|")],
    queryFn: () => newsletterApi.bildUrls(pfade),
    enabled: pfade.length > 0,
    // Die URLs gelten 30 Minuten; eine halbe Stunde vorher neu zu holen wäre
    // Arbeit ohne Wirkung.
    staleTime: 20 * 60 * 1000,
  });

  return data ?? {};
}
