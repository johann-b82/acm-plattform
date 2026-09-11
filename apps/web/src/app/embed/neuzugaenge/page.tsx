"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { anzeigeApi, anzeigeKeys, name } from "@/lib/anzeige";
import { Kachel, OhneToken, PRO_SEITE, Tafel } from "@/components/anzeige/tafel";
import { sekundenAus, useBlaettern } from "@/components/anzeige/blaettern";

/**
 * Wer zuletzt angefangen hat — die zweite Tafel.
 *
 * `?wochen=` steuert, wie weit zurück jemand noch „neu“ ist; ohne Angabe sind
 * es zwölf Wochen. Das Eintrittsdatum darf hier stehen: es ist kein
 * besonderer Datenpunkt, und ohne es hätte die Kachel nichts zu sagen.
 */
export default function NeuzugaengePage() {
  return (
    <Suspense fallback={null}>
      <Neuzugaenge />
    </Suspense>
  );
}

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" });

function Neuzugaenge() {
  const parameter = useSearchParams();
  const token = parameter.get("token") ?? "";
  const sekunden = sekundenAus(parameter);
  const gelesen = Number.parseInt(parameter.get("wochen") ?? "", 10);
  const wochen = Number.isFinite(gelesen) && gelesen > 0 ? Math.min(gelesen, 52) : 12;

  const abfrage = useQuery({
    queryKey: [...anzeigeKeys.liste("neuzugaenge", token), wochen],
    queryFn: () => anzeigeApi.neuzugaenge(token, wochen),
    enabled: token !== "",
  });

  const alle = abfrage.data ?? [];
  const { seite } = useBlaettern(alle.length, PRO_SEITE, sekunden);
  const sichtbar = alle.slice(seite * PRO_SEITE, seite * PRO_SEITE + PRO_SEITE);

  if (token === "") return <OhneToken />;

  return (
    <Tafel
      titel="Neu im Team"
      laedt={abfrage.isLoading}
      fehler={abfrage.error as Error | null}
      leer={alle.length === 0}
      leerText="Zuletzt hat niemand angefangen."
    >
      {sichtbar.map((person) => (
        <Kachel
          key={person.id}
          person={person}
          token={token}
          hervorgehoben={person.tage_dabei <= 7}
          name={name(person)}
          zeile={`seit ${DATUM.format(new Date(person.eintritt + "T00:00:00"))}`}
        />
      ))}
    </Tafel>
  );
}
