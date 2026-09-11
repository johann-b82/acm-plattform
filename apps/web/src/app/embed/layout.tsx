import type { Metadata } from "next";

import { AnzeigeProvider } from "./provider";

export const metadata: Metadata = {
  title: "Anzeige · ACM",
  // Eine Tafel gehört nicht in einen Suchindex.
  robots: { index: false, follow: false },
};

/**
 * Die Hülle der Bildschirmanzeigen — bewusst ohne alles.
 *
 * Keine Kopfzeile, keine Navigation, kein Abmelden: Diese Seiten laufen im
 * Rahmen des Signage-Players auf einer Tafel im Flur, es sitzt niemand davor.
 * Sie liegen deshalb außerhalb von `(app)`, und der Proxy lässt `/embed/*`
 * ausdrücklich ohne Sitzung durch (`src/proxy.ts`). Die Daten hängen
 * stattdessen am signierten Token in der Adresse.
 */
export default function AnzeigeLayout({ children }: { children: React.ReactNode }) {
  return <AnzeigeProvider>{children}</AnzeigeProvider>;
}
