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

export function Tafel({
  titel,
  laedt,
  fehler,
  leer,
  leerText,
  children,
}: {
  titel: string;
  laedt: boolean;
  fehler: Error | null;
  leer: boolean;
  leerText: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col gap-12 p-16">
      <h1 className="text-6xl font-semibold tracking-tight">{titel}</h1>
      {laedt && <p className="text-4xl text-[var(--fg-muted)]">Einen Moment …</p>}
      {fehler && <p className="text-4xl text-[var(--danger)]">{fehler.message}</p>}
      {!laedt && !fehler && leer && (
        <p className="text-4xl text-[var(--fg-muted)]">{leerText}</p>
      )}
      {!laedt && !fehler && !leer && (
        <ul className="grid flex-1 content-start gap-12 xl:grid-cols-2">{children}</ul>
      )}
    </main>
  );
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
        "flex items-center gap-12 rounded-2xl border p-16 " +
        (hervorgehoben
          ? "border-[var(--ring)] bg-[var(--muted)]"
          : "border-[var(--border)] bg-[var(--surface)]")
      }
    >
      <Bild person={person} token={token} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-5xl font-semibold">{name}</p>
        {person.abteilung && (
          <p className="mt-3 truncate text-3xl text-[var(--fg-muted)]">{person.abteilung}</p>
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
