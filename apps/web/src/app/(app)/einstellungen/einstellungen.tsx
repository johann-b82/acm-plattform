"use client";

import { useEffect, useState } from "react";

import { GRUPPEN, type Gruppe } from "@/lib/einstellungen";
import { Hinweis } from "@/components/ui/hinweis";
import { Label, Select } from "@/components/ui/primitives";

import { Kennzahlen } from "./abschnitte/kennzahlen";
import { Personal } from "./abschnitte/personal";
import { PersonioZugang } from "./abschnitte/personio-zugang";
import { AtrVorlagen } from "./abschnitte/atr-vorlagen";
import { Eingangsordner } from "./abschnitte/atr-eingangsordner";
import { Logo } from "./abschnitte/logo";
import { Erscheinung } from "./abschnitte/erscheinung";
import { Tabellen } from "./abschnitte/tabellen";
import { Anzeigen } from "./abschnitte/anzeigen";
import { Email } from "./abschnitte/email";
import { Zeugnisse } from "./abschnitte/zeugnisse";
import { Qualitaet } from "./abschnitte/qualitaet";
import { Sensoren } from "./abschnitte/sensoren";
import { Zugaenge } from "./abschnitte/zugaenge";
import { ActiveDirectory } from "./abschnitte/ad";
import { Seitenkopf } from "@/components/seitenkopf";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge, Werkzeug, useInSchale } from "@/components/sidebar/werkzeugplatz";

/** Die Gruppen-Kennung aus der Adresse (`/einstellungen#sensoren`), falls es
 *  sie gibt — sonst nichts. So landet die Weiterleitung von `/platform` auf
 *  „Zugänge" und geteilte Links auf ihrem Bereich. */
function ausHash(): string | null {
  if (typeof window === "undefined") return null;
  const id = window.location.hash.replace(/^#/, "");
  return GRUPPEN.some((g) => g.id === id) ? id : null;
}

/**
 * Alle Einstellungen an einer Stelle, in Kategorien.
 *
 * Vorher lag jede Einstellung dort, wo sie fachlich hingehörte — die
 * ATR-Vorlagen im Teilekatalog, der Eingangsordner unter den Lieferungen, die
 * Konten in einer eigenen Verwaltung. Wer etwas einstellen wollte, musste
 * wissen, wo. Jetzt gibt es einen Ort und eine Gliederung.
 *
 * Die Kategorie wird über ein Auswahlmenü gewählt; darunter steht nur der
 * gewählte Bereich. Die Wahl steht in der Adresse (`#sensoren`), damit
 * Weiterleitungen und geteilte Links ihren Bereich treffen.
 *
 * Die Seite gehört der Plattform-Verwaltung; das Tor sitzt in `page.tsx`.
 * Deshalb steht hier keine Rechteprüfung mehr je Abschnitt: was hier steht,
 * gilt ohnehin für alle.
 */
export function Einstellungen({ eigeneId }: { eigeneId: string }) {
  const worte = useTexte();
  const gruppen = worte.einstellungen.gruppen as Record<string, string>;
  const inSchale = useInSchale();

  const [gewaehlt, setGewaehlt] = useState<string>(() => ausHash() ?? GRUPPEN[0].id);

  // Sprünge über die Adresse (etwa die Weiterleitung von `/platform`) mitnehmen.
  useEffect(() => {
    const auf = () => {
      const id = ausHash();
      if (id) setGewaehlt(id);
    };
    window.addEventListener("hashchange", auf);
    return () => window.removeEventListener("hashchange", auf);
  }, []);

  function waehle(id: string) {
    setGewaehlt(id);
    // Die Adresse teilbar halten, ohne die Historie vollzuschreiben.
    history.replaceState(null, "", `#${id}`);
  }

  const gruppe = GRUPPEN.find((g) => g.id === gewaehlt) ?? GRUPPEN[0];

  const auswahl = (
    <Select
      id="einstellungsbereich"
      aria-label={worte.einstellungen.bereiche}
      value={gruppe.id}
      onChange={(e) => waehle(e.target.value)}
    >
      {GRUPPEN.map((g) => (
        <option key={g.id} value={g.id}>
          {gruppen[g.id]}
        </option>
      ))}
    </Select>
  );

  const inhalt = (
    <section id={gruppe.id} className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-lg font-medium tracking-tight">
        {gruppen[gruppe.id]}
        <Hinweis text={gruppen[`${gruppe.id}Text`]} />
      </h2>
      <Inhalt gruppe={gruppe} eigeneId={eigeneId} />
    </section>
  );

  if (inSchale) {
    return (
      <div className="space-y-6">
        <Seitenwerkzeuge kategorie="navigation">
          <Werkzeug titel={worte.einstellungen.bereiche}>{auswahl}</Werkzeug>
        </Seitenwerkzeuge>
        {inhalt}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Seitenkopf />
      <div className="flex flex-col gap-1 sm:max-w-xs">
        <Label htmlFor="einstellungsbereich">{worte.einstellungen.bereiche}</Label>
        {auswahl}
      </div>
      {inhalt}
    </div>
  );
}

function Inhalt({ gruppe, eigeneId }: { gruppe: Gruppe; eigeneId: string }) {
  switch (gruppe.id) {
    case "kennzahlen":
      return <Kennzahlen />;
    case "personal":
      return (
        <div className="space-y-4">
          <Personal />
          <PersonioZugang />
        </div>
      );
    case "atr":
      return (
        <div className="space-y-4">
          <AtrVorlagen />
          <Eingangsordner />
        </div>
      );
    case "qualitaet":
      return <Qualitaet />;
    case "sensoren":
      return <Sensoren />;
    case "zeugnisse":
      return <Zeugnisse />;
    case "erscheinung":
      return (
        <div className="space-y-4">
          <Erscheinung />
          <Logo />
          <Tabellen />
        </div>
      );
    case "anzeigen":
      return <Anzeigen />;
    case "email":
      return <Email />;
    case "ad":
      return <ActiveDirectory />;
    case "zugaenge":
      return <Zugaenge eigeneId={eigeneId} />;
    default:
      return null;
  }
}
