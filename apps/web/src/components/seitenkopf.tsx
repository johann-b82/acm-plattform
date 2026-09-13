import type { ReactNode } from "react";

/**
 * Was unter der Kopfzeile über dem Inhalt steht.
 *
 * Den Namen der Seite trägt die Kopfzeile. Hier steht der Satz darunter,
 * **linksbündig an der Inhaltskante** (UI-02), daneben links die fachlichen
 * Umschalter der Seite (Material/Personal, Audits/Reklamationen/…) und rechts
 * die Zeitraumwahl mit ihrem Datenstand. Umschalter und Zeitraumwahl stehen
 * auf einer Höhe; wird es schmal, rutscht die rechte Gruppe darunter.
 */
export function Seitenkopf({
  untertitel,
  unter,
  links,
  bedienung,
}: {
  untertitel?: ReactNode;
  /** Was direkt unter den Untertitel gehört — etwa Verweise auf Nachbarseiten. */
  unter?: ReactNode;
  /** Fachliche Umschalter, links auf Höhe der Bedienung. */
  links?: ReactNode;
  /** Zeitraumwahl und andere Bedienung, rechts. */
  bedienung?: ReactNode;
}) {
  if (!untertitel && !unter && !links && !bedienung) return null;
  return (
    <div className="space-y-3">
      {(untertitel || unter) && (
        <div className="text-start">
          {untertitel && <p className="text-sm text-[var(--fg-muted)]">{untertitel}</p>}
          {unter}
        </div>
      )}
      {(links || bedienung) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">{links}</div>
          {bedienung && <div className="ms-auto flex flex-wrap items-start justify-end gap-2">{bedienung}</div>}
        </div>
      )}
    </div>
  );
}
