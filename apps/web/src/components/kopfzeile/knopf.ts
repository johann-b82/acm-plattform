/**
 * Ein Zeichen in der Kopfzeile: quadratische Fläche, sichtbarer Tastaturfokus.
 * Steht hier, weil inzwischen mehrere Dateien Knöpfe in die Kopfzeile hängen
 * und sie gleich aussehen müssen.
 */
export const KNOPF =
  "inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-muted)] " +
  "transition-colors hover:bg-[var(--muted)] hover:text-[var(--fg)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";
