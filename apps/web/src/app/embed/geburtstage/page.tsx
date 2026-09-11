"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { anzeigeApi, anzeigeKeys, name, WOCHENTAGE } from "@/lib/anzeige";
import { Kachel, OhneToken, PRO_SEITE, Tafel, zustandAus } from "@/components/anzeige/tafel";
import { sekundenAus, useBlaettern } from "@/components/anzeige/blaettern";

/**
 * Wer diese Woche Geburtstag hat — die Tafel im Flur.
 *
 * Was hier steht, ist absichtlich wenig: Name, Abteilung, Wochentag. Kein
 * Datum, kein Alter. Das Geburtsdatum bleibt in Personio und verlässt den
 * Server nicht, auch nicht als Zahl.
 */
export default function GeburtstagePage() {
  // `useSearchParams` verlangt eine Suspense-Grenze, sonst rendert Next die
  // ganze Seite nur im Browser.
  return (
    <Suspense fallback={null}>
      <Geburtstage />
    </Suspense>
  );
}

function heutigerWochentag(): number {
  // Wie Pythons `date.weekday()`: Montag = 0 … Sonntag = 6.
  const tag = new Date().getDay();
  return tag === 0 ? 6 : tag - 1;
}

function Geburtstage() {
  const parameter = useSearchParams();
  const token = parameter.get("token") ?? "";
  const sekunden = sekundenAus(parameter);
  const heute = heutigerWochentag();

  const abfrage = useQuery({
    queryKey: anzeigeKeys.liste("geburtstage", token),
    queryFn: () => anzeigeApi.geburtstage(token),
    enabled: token !== "",
  });

  const alle = abfrage.data ?? [];
  const { seite } = useBlaettern(alle.length, PRO_SEITE, sekunden);
  const sichtbar = alle.slice(seite * PRO_SEITE, seite * PRO_SEITE + PRO_SEITE);

  if (token === "") return <OhneToken />;

  return (
    <Tafel
      titel="Geburtstage diese Woche"
      zustand={zustandAus(abfrage, alle.length)}
      leerText="Diese Woche hat niemand Geburtstag."
    >
      {sichtbar.map((person) => (
        <Kachel
          key={person.id}
          person={person}
          token={token}
          hervorgehoben={person.wochentag === heute}
          name={name(person)}
          zeile={
            person.wochentag === heute ? (
              <span className="rounded-full bg-[var(--ring)] px-5 py-1.5 font-medium text-white">
                Heute
              </span>
            ) : (
              WOCHENTAGE[person.wochentag]
            )
          }
        />
      ))}
    </Tafel>
  );
}
