/**
 * Hell, dunkel oder wie das Betriebssystem.
 *
 * Drei Stufen, nicht zwei: „wie das Betriebssystem" ist die Vorgabe und muss
 * wählbar bleiben. Ein reiner Umschalter hell/dunkel nimmt einem die
 * Möglichkeit, wieder auf den Systemwert zurückzugehen — und wer morgens hell
 * und abends dunkel arbeitet, will genau das.
 *
 * Die Wahl steht im `localStorage` des Geräts, nicht am Konto: sie gehört zum
 * Bildschirm, vor dem jemand sitzt. Wer am Arbeitsplatz hell und am Laptop
 * dunkel will, soll das haben.
 */

export type Erscheinungsbild = "system" | "hell" | "dunkel";

export const SCHLUESSEL = "erscheinungsbild";

export const ERSCHEINUNGSBILD_LABEL: Record<Erscheinungsbild, string> = {
  system: "Wie das System",
  hell: "Hell",
  dunkel: "Dunkel",
};

function istWahl(wert: unknown): wert is Erscheinungsbild {
  return wert === "system" || wert === "hell" || wert === "dunkel";
}

/** Was gespeichert ist — oder die Vorgabe. */
export function gespeichert(): Erscheinungsbild {
  try {
    const wert = window.localStorage.getItem(SCHLUESSEL);
    return istWahl(wert) ? wert : "system";
  } catch {
    // Privates Fenster oder gesperrter Speicher: dann eben die Vorgabe.
    return "system";
  }
}

/**
 * Die Wahl auf das Dokument schreiben.
 *
 * `system` entfernt das Attribut, statt einen Wert zu setzen — dann greift
 * wieder die Abfrage nach `prefers-color-scheme`, und zwar auch dann noch,
 * wenn jemand später am Betriebssystem umstellt.
 */
export function anwenden(wahl: Erscheinungsbild): void {
  const wurzel = document.documentElement;
  if (wahl === "system") {
    wurzel.removeAttribute("data-theme");
  } else {
    wurzel.dataset.theme = wahl === "dunkel" ? "dark" : "light";
  }
}

export function merken(wahl: Erscheinungsbild): void {
  try {
    if (wahl === "system") window.localStorage.removeItem(SCHLUESSEL);
    else window.localStorage.setItem(SCHLUESSEL, wahl);
  } catch {
    // Nicht schlimm: dann gilt die Wahl bis zum Neuladen.
  }
  for (const horcher of horcher_liste) horcher();
}

// --- Ein kleiner Speicher, damit React zusehen kann ---------------------------
//
// Der Umschalter liest die Wahl nicht in einem Effekt, sondern über
// `useSyncExternalStore`. Zwei Gründe: ein Effekt, der beim Einhängen Zustand
// nachzieht, ist genau das Muster, das React (und der Linter) ablehnt — und
// über den Speicher fällt der Abgleich zwischen mehreren Tabs von selbst ab.

type Horcher = () => void;
const horcher_liste = new Set<Horcher>();

export function abonnieren(horcher: Horcher): () => void {
  horcher_liste.add(horcher);
  // Ein zweiter Tab meldet sich über `storage` — dort läuft `merken` nicht.
  const vonAussen = (e: StorageEvent) => {
    if (e.key === SCHLUESSEL || e.key === null) {
      anwenden(gespeichert());
      horcher();
    }
  };
  window.addEventListener("storage", vonAussen);
  return () => {
    horcher_liste.delete(horcher);
    window.removeEventListener("storage", vonAussen);
  };
}

/** Auf dem Server gibt es keinen `localStorage` — dort gilt die Vorgabe. */
export function aufDemServer(): Erscheinungsbild {
  return "system";
}

/**
 * Läuft vor dem ersten Bild, direkt im Dokumentkopf.
 *
 * Ohne das blitzt bei einer dunklen Wahl kurz die helle Seite auf, weil React
 * erst nach dem ersten Malen zum Zug kommt. Deshalb als Zeichenkette und
 * nicht als Modul: es muss ausgeführt sein, bevor irgendetwas gezeichnet wird.
 */
export const VORSCHALTSKRIPT = `
(function () {
  try {
    var w = localStorage.getItem(${JSON.stringify(SCHLUESSEL)});
    if (w === "dunkel") document.documentElement.dataset.theme = "dark";
    else if (w === "hell") document.documentElement.dataset.theme = "light";
  } catch (e) {}
})();
`.trim();
