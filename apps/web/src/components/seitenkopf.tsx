import type { ReactNode } from "react";

/**
 * Was unter der Kopfzeile über dem Inhalt steht: der Untertitel und die
 * Bedienelemente.
 *
 * Den Namen der Seite trägt die Kopfzeile — mittig, an derselben Stelle auf
 * jeder Seite. Hier steht nur noch der Satz darunter, der erklärt, was man
 * gerade sieht.
 *
 * Die Bedienelemente einer Seite (Zeitraumwahl, Filter) stehen darunter und
 * rechtsbündig: sie gehören zum Inhalt, nicht zur Überschrift.
 */
export function Seitenkopf({
  untertitel,
  unter,
  bedienung,
}: {
  untertitel?: ReactNode;
  /** Was direkt unter den Untertitel gehört — etwa der Datenstand. */
  unter?: ReactNode;
  bedienung?: ReactNode;
}) {
  if (!untertitel && !unter && !bedienung) return null;
  return (
    <div className="space-y-3">
      {(untertitel || unter) && (
        <div className="text-center">
          {untertitel && (
            <p className="mx-auto max-w-prose text-sm text-[var(--fg-muted)]">{untertitel}</p>
          )}
          {unter}
        </div>
      )}
      {bedienung && <div className="flex flex-wrap justify-end gap-2">{bedienung}</div>}
    </div>
  );
}
