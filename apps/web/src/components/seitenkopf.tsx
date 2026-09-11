import type { ReactNode } from "react";

/**
 * Der Kopf einer Seite: Überschrift und Untertitel mittig über dem Inhalt.
 *
 * Mittig, weil der Pfad in die Kopfzeile gezogen ist — die linke obere Ecke
 * gehört jetzt dem Weg, nicht dem Titel. Eine Überschrift in der Mitte findet
 * das Auge auch dann, wenn die Seite darunter breit ist.
 *
 * Die Bedienelemente einer Seite (Zeitraumwahl, Filter) stehen darunter und
 * rechtsbündig: sie gehören zum Inhalt, nicht zur Überschrift.
 */
export function Seitenkopf({
  titel,
  untertitel,
  unter,
  bedienung,
}: {
  titel: string;
  untertitel?: ReactNode;
  /** Was direkt unter den Untertitel gehört — etwa der Datenstand. */
  unter?: ReactNode;
  bedienung?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{titel}</h1>
        {untertitel && (
          <p className="mx-auto mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{untertitel}</p>
        )}
        {unter}
      </div>
      {bedienung && <div className="flex flex-wrap justify-end gap-2">{bedienung}</div>}
    </div>
  );
}
