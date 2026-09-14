"use client";

import type { ReactNode } from "react";

import { Seitenwerkzeuge, useInSchale } from "@/components/sidebar/werkzeugplatz";

/**
 * Was unter der Kopfzeile über dem Inhalt steht.
 *
 * Den Namen der Seite trägt die Kopfzeile. Hier steht der Satz darunter,
 * **linksbündig an der Inhaltskante** (UI-02).
 *
 * Die fachlichen Umschalter der Seite (Material/Personal, Audits/…) und die
 * Bedienung (Zeitraumwahl mit Datenstand, Uploads, Abgleich) gelten für die
 * ganze Seite. In der Schale stehen sie deshalb in der rechten Leiste, unter
 * einander. Ohne Schale — etwa im Komponententest — bleiben sie im Kopf:
 * Umschalter links, Bedienung rechts auf einer Höhe.
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
  /** Fachliche Umschalter der Seite. */
  links?: ReactNode;
  /** Zeitraumwahl und andere Bedienung. */
  bedienung?: ReactNode;
}) {
  const inSchale = useInSchale();
  if (!untertitel && !unter && !links && !bedienung) return null;

  const satz = (untertitel || unter) && (
    <div className="text-start">
      {untertitel && <p className="text-sm text-[var(--fg-muted)]">{untertitel}</p>}
      {unter}
    </div>
  );

  if (inSchale) {
    return (
      <>
        {satz}
        {/* Umschalter gehören zur Ansicht, die übrige Bedienung zu den Aktionen.
            Was eine andere Kategorie hat (die Zeitraumwahl, Filter), stellt
            sich selbst dorthin. */}
        {links && (
          <Seitenwerkzeuge kategorie="ansicht">
            <div className="flex flex-col items-start gap-2">{links}</div>
          </Seitenwerkzeuge>
        )}
        {bedienung && (
          <Seitenwerkzeuge kategorie="aktionen">
            <div className="flex flex-col items-stretch gap-2">{bedienung}</div>
          </Seitenwerkzeuge>
        )}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {satz}
      {(links || bedienung) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">{links}</div>
          {bedienung && <div className="ms-auto flex flex-wrap items-start justify-end gap-2">{bedienung}</div>}
        </div>
      )}
    </div>
  );
}
