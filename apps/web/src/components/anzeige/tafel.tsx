"use client";

import { useState, type ReactNode } from "react";

import { anzeigeApi, initialen } from "@/lib/anzeige";

/**
 * Die gemeinsame Form beider Tafeln: Überschrift, zwei große Kacheln,
 * Zustandstexte. Geburtstage und Neuzugänge unterscheiden sich nur darin, was
 * unter dem Namen steht.
 *
 * Alles ist auf Entfernung ausgelegt — die Tafel hängt im Flur, gelesen wird
 * sie im Vorbeigehen von mehreren Metern. Deshalb die groben Größen: was auf
 * einem Bildschirm am Schreibtisch übertrieben wirkt, ist hier gerade richtig.
 */

export const PRO_SEITE = 2;

/**
 * Der Zustand kommt als **ein** Wert herein, nicht als drei Schalter.
 *
 * Das ist keine Kosmetik: mit `laedt`, `fehler` und `leer` nebeneinander zeigte
 * die Tafel bei einem abgelehnten Token „Zuletzt hat niemand angefangen" —
 * weil die Liste eben leer war. Auf einem Bildschirm im Flur sieht ein
 * kaputter Token damit aus wie eine ruhige Woche, und niemand merkt es.
 * „Leer" heißt jetzt: die Abfrage ist durch und hat nichts geliefert.
 */
export type Zustand =
  | { art: "laedt" }
  | { art: "fehler"; text: string }
  | { art: "leer" }
  | { art: "daten" };

export function Tafel({
  titel,
  zustand,
  leerText,
  children,
}: {
  titel: string;
  zustand: Zustand;
  leerText: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col gap-12 p-16">
      <h1 className="text-6xl font-semibold tracking-tight">{titel}</h1>
      {zustand.art === "laedt" && (
        <p className="text-4xl text-[var(--fg-muted)]">Einen Moment …</p>
      )}
      {zustand.art === "fehler" && (
        <p className="text-4xl text-[var(--danger)]">{zustand.text}</p>
      )}
      {zustand.art === "leer" && (
        <p className="text-4xl text-[var(--fg-muted)]">{leerText}</p>
      )}
      {zustand.art === "daten" && (
        <ul className="grid flex-1 content-start gap-12 xl:grid-cols-2">{children}</ul>
      )}
    </main>
  );
}

/** Den Zustand aus einer TanStack-Abfrage ableiten — für beide Tafeln gleich. */
export function zustandAus(
  abfrage: { isError: boolean; isSuccess: boolean; error: unknown },
  anzahl: number,
): Zustand {
  if (abfrage.isError) {
    return {
      art: "fehler",
      text: abfrage.error instanceof Error ? abfrage.error.message : "Unbekannter Fehler.",
    };
  }
  if (!abfrage.isSuccess) return { art: "laedt" };
  return anzahl === 0 ? { art: "leer" } : { art: "daten" };
}

export function Kachel({
  person,
  token,
  hervorgehoben,
  name,
  zeile,
}: {
  person: { id: number; vorname: string | null; nachname: string | null; abteilung: string | null; hat_foto: boolean };
  token: string;
  hervorgehoben?: boolean;
  name: string;
  zeile: ReactNode;
}) {
  return (
    <li
      className={
        "flex items-center gap-10 rounded-2xl border p-12 " +
        (hervorgehoben
          ? "border-[var(--ring)] bg-[var(--muted)]"
          : "border-[var(--border)] bg-[var(--surface)]")
      }
    >
      <Bild person={person} token={token} />
      <div className="min-w-0 flex-1">
        {/* Kein `truncate`: ein abgeschnittener Name ist auf einer Tafel das
            eine, was nicht passieren darf. Lieber zwei Zeilen. */}
        <p className="text-5xl font-semibold text-balance break-words">{name}</p>
        {person.abteilung && (
          <p className="mt-3 text-3xl break-words text-[var(--fg-muted)]">{person.abteilung}</p>
        )}
        <div className="mt-4 text-3xl tabular-nums text-[var(--fg-muted)]">{zeile}</div>
      </div>
    </li>
  );
}

function Bild({
  person,
  token,
}: {
  person: { id: number; vorname: string | null; nachname: string | null; hat_foto: boolean };
  token: string;
}) {
  // Personio nimmt zwischen Liste und Anzeige gelegentlich ein Bild weg.
  // Dann greift der Namenskreis — über einen Zustand, nicht über einen Griff
  // ins DOM, damit React sauber tauschen kann.
  const [gescheitert, setGescheitert] = useState(false);
  const zeigen = person.hat_foto && !gescheitert;
  return (
    <div className="h-48 w-48 shrink-0 overflow-hidden rounded-full bg-[var(--muted)]">
      {zeigen ? (
        // Ein Weiterleitungspfad mit Token im Abfrageteil; `next/image` bräuchte
        // dafür eine Host-Freigabe und brächte hier nichts.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={anzeigeApi.fotoUrl(person.id, token)}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setGescheitert(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-6xl font-semibold text-[var(--fg-muted)]">
          {initialen(person.vorname, person.nachname)}
        </span>
      )}
    </div>
  );
}

/** Fehlt der Token, sagt die Tafel warum — sonst stünde sie stumm im Flur. */
export function OhneToken() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-16 text-center">
      <p className="text-5xl font-semibold">Kein Token</p>
      <p className="max-w-3xl text-3xl text-[var(--fg-muted)]">
        Diese Anzeige braucht einen signierten Token in der Adresse. Einen
        erzeugen die Einstellungen der Plattform unter „Anzeigen“.
      </p>
    </main>
  );
}
