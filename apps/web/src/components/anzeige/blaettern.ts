"use client";

import { useEffect, useState } from "react";

/**
 * Das Blättern der Tafel — und der Übergang zum nächsten Playlist-Eintrag.
 *
 * Zwei Dinge, die zusammengehören: Auf einer Tafel passen zwei Kacheln
 * nebeneinander, bei mehr Personen muss geblättert werden. Und der
 * Signage-Player weiß nicht, wie lange diese Seite braucht — er hängt
 * `?duration=<sekunden>` an und meint damit **eine Seite**, nicht die ganze
 * Anzeige. Ist die letzte Seite abgelaufen, meldet sich die Anzeige mit
 * `{ type: "embed-cycle-complete" }` beim Fenster darüber; darauf hört der
 * Player (`IframePlayer.tsx` im Repo `acm-signage`) und schaltet weiter.
 *
 * Ohne diese Meldung bliebe die Tafel auf der Notbremse des Players stehen —
 * er hat eine, aber sie ist grob.
 */

const VORGABE_S = 10;
const MINDEST_MS = 2_000;

/** Die Sekunden je Seite aus der Adresse. Ohne Angabe zehn. */
export function sekundenAus(parameter: { get(name: string): string | null }): number {
  const roh = parameter.get("duration");
  const gelesen = roh != null ? Number.parseInt(roh, 10) : Number.NaN;
  return Number.isFinite(gelesen) && gelesen > 0 ? gelesen : VORGABE_S;
}

export function useBlaettern(anzahl: number, proSeite: number, sekunden: number) {
  const seiten = Math.max(1, Math.ceil(anzahl / proSeite));
  // Eine Untergrenze, damit ein vertipptes `duration=0` die Tafel nicht
  // flackern lässt.
  const dauerMs = Math.max(MINDEST_MS, sekunden * 1000);

  const [seite, setSeite] = useState(0);

  // Ändert sich die Zahl der Seiten — über Nacht rollt ein Geburtstag herein —,
  // fängt die Tafel vorn an. Das Nachziehen gehört in den Rendervorgang und
  // nicht in einen Effekt: ein Effekt zeigte erst ein Bild mit einem Index,
  // den es nicht mehr gibt.
  const [bekannteSeiten, setBekannteSeiten] = useState(seiten);
  if (bekannteSeiten !== seiten) {
    setBekannteSeiten(seiten);
    setSeite(0);
  }

  useEffect(() => {
    let schritt = 0;
    const id = window.setInterval(() => {
      schritt += 1;
      if (schritt >= seiten) {
        window.clearInterval(id);
        try {
          window.parent.postMessage({ type: "embed-cycle-complete" }, "*");
        } catch {
          // Steht die Seite allein im Browser, gibt es niemanden darüber.
        }
      } else {
        setSeite(schritt);
      }
    }, dauerMs);
    return () => window.clearInterval(id);
  }, [seiten, dauerMs]);

  return { seite, seiten };
}
