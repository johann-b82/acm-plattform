"use client";

import { useState } from "react";
import Link from "next/link";

import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";
import { Seitenwerkzeuge, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { cn } from "@/lib/cn";
import { RegisterBearbeiten } from "./register-bearbeiten";
import { RegisterZuweisen } from "./register-zuweisen";
import { RegisterStand } from "./register-stand";

export type Ansicht = "bearbeiten" | "zuweisen" | "stand";

/**
 * Schulungen in drei Registern wie im Altsystem (SCH-04): „Schulungen
 * bearbeiten“ (Katalog und Import), „Schulung zuweisen“ (Anforderungsmatrix,
 * Einzelzuweisung, Sammelabschluss) und „Stand der Mitarbeiter“ (offene
 * Schulungen, Übersicht, Gesamtmatrix, Abteilungen). Die Detailseite je
 * Schulung ist über den Namen im Katalog erreichbar.
 *
 * Die Register gelten für die ganze Seite und stehen in der Schale deshalb in
 * der rechten Leiste, dort unter einander; ohne Schale als Reiter darüber.
 */
export function Schulungen({ darfSchreiben, start = "bearbeiten" }: { darfSchreiben: boolean; start?: Ansicht }) {
  const worte = useTexte();
  const inSchale = useInSchale();
  const [ansicht, setAnsicht] = useState<Ansicht>(start);

  const register: { wert: Ansicht; titel: string }[] = [
    { wert: "bearbeiten", titel: worte.schulungenReg.tabBearbeiten },
    { wert: "zuweisen", titel: worte.schulungenReg.tabZuweisen },
    { wert: "stand", titel: worte.schulungenReg.tabStand },
  ];

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.schulungen.einleitung}
        unter={
          <div className="mt-2 flex flex-wrap justify-start gap-4 text-sm">
            <Link href="/hr/onboarding#vorgaenge" className="underline-offset-4 hover:underline">
              {worte.schulungen.dokumentenlauf}
            </Link>
          </div>
        }
      />

      <Seitenwerkzeuge kategorie="navigation">
        <div
          className={cn(
            "flex gap-1",
            inSchale ? "flex-col items-stretch border-s border-[var(--border)]" : "border-b border-[var(--border)]",
          )}
          role="tablist"
          aria-label={worte.pfad.seiten["/hr/schulungen"]}
        >
          {register.map((r) => (
            <button
              key={r.wert}
              type="button"
              role="tab"
              aria-selected={ansicht === r.wert}
              onClick={() => setAnsicht(r.wert)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
                inSchale ? "-ms-px border-s-2 text-start" : "-mb-px border-b-2",
                ansicht === r.wert
                  ? "border-[var(--fg)] text-[var(--fg)]"
                  : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              {r.titel}
            </button>
          ))}
        </div>
      </Seitenwerkzeuge>

      {ansicht === "bearbeiten" && <RegisterBearbeiten darfSchreiben={darfSchreiben} />}
      {ansicht === "zuweisen" && <RegisterZuweisen darfSchreiben={darfSchreiben} />}
      {ansicht === "stand" && <RegisterStand />}
    </div>
  );
}
