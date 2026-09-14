"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { einarbeitungApi, einarbeitungKeys } from "@/lib/einarbeitung";
import { onboardingApi, onboardingKeys } from "@/lib/onboarding";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";
import { Klappbar } from "../klappbar";
import { Einarbeitungsinhalte, Einarbeitungsmatrix } from "./einarbeitung";
import { Rollen } from "./rollen";
import { Vorgaenge } from "./vorgaenge";
import { Eintritte } from "./eintritte";

/**
 * Onboarding — der gemeinsame Einstieg für Eintritte und Einarbeitung (NAV-01).
 *
 * Aufbau und Reihenfolge wie im Altsystem: Einarbeitungsinhalte, ihre Matrix,
 * die Rollenbrücke, darunter die Einarbeitungs- und Schulungsvorgänge und
 * zuletzt die Eintritte. Die früheren eigenen Seiten Einarbeitung und
 * Dokumentenlauf leiten hierher weiter und springen auf ihren Abschnitt.
 */
export function Onboarding({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const katalog = useQuery({ queryKey: einarbeitungKeys.katalog(), queryFn: einarbeitungApi.katalog });
  const rollen = useQuery({ queryKey: onboardingKeys.rollen(), queryFn: onboardingApi.rollen });

  return (
    <div className="space-y-6">
      <Seitenkopf
        unter={
          <div className="mt-2 flex justify-start gap-4 text-sm">
            <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/schulungen"]}
            </Link>
          </div>
        }
      />

      <Klappbar id="einarbeitung" titel={worte.onboarding.inhalteTitel} anzahl={katalog.data?.length} offenStart={false}>
        <Einarbeitungsinhalte darfSchreiben={darfSchreiben} />
      </Klappbar>

      <Klappbar id="einarbeitungsmatrix" titel={worte.onboarding.matrixTitel} offenStart={false}>
        <Einarbeitungsmatrix darfSchreiben={darfSchreiben} />
      </Klappbar>

      <Klappbar id="rollen" titel={worte.onboarding.bruecke} anzahl={rollen.data?.length} offenStart={false}>
        <Rollen darfSchreiben={darfSchreiben} />
      </Klappbar>

      <section id="vorgaenge" className="scroll-mt-4 space-y-3">
        <h2 className="font-medium">{worte.onboarding.vorgaengeTitel}</h2>
        <Vorgaenge darfSchreiben={darfSchreiben} />
      </section>

      <section id="eintritte" className="scroll-mt-4 space-y-3">
        <h2 className="font-medium">{worte.onboarding.eintritteTitel}</h2>
        <Eintritte darfSchreiben={darfSchreiben} />
      </section>
    </div>
  );
}
