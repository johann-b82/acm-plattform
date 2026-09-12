"use client";

import { GRUPPEN, type Gruppe } from "@/lib/einstellungen";
import { Hinweis } from "@/components/ui/hinweis";

import { Kennzahlen } from "./abschnitte/kennzahlen";
import { Personal } from "./abschnitte/personal";
import { PersonioZugang } from "./abschnitte/personio-zugang";
import { AtrVorlagen } from "./abschnitte/atr-vorlagen";
import { Eingangsordner } from "./abschnitte/atr-eingangsordner";
import { Logo } from "./abschnitte/logo";
import { Tabellen } from "./abschnitte/tabellen";
import { Anzeigen } from "./abschnitte/anzeigen";
import { Zeugnisse } from "./abschnitte/zeugnisse";
import { Qualitaet } from "./abschnitte/qualitaet";
import { Sensoren } from "./abschnitte/sensoren";
import { Zugaenge } from "./abschnitte/zugaenge";
import { Seitenkopf } from "@/components/seitenkopf";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Alle Einstellungen an einer Stelle, nach Bereich gruppiert.
 *
 * Vorher lag jede Einstellung dort, wo sie fachlich hingehörte — die
 * ATR-Vorlagen im Teilekatalog, der Eingangsordner unter den Lieferungen, die
 * Konten in einer eigenen Verwaltung. Wer etwas einstellen wollte, musste
 * wissen, wo. Jetzt gibt es einen Ort und eine Gliederung.
 *
 * Die Seite gehört der Plattform-Verwaltung; das Tor sitzt in `page.tsx`.
 * Deshalb steht hier keine Rechteprüfung mehr je Abschnitt: was hier steht,
 * gilt ohnehin für alle.
 */
export function Einstellungen({ eigeneId }: { eigeneId: string }) {
  const worte = useTexte();
  const gruppen = worte.einstellungen.gruppen as Record<string, string>;
  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.einstellungen.einleitung}
      />

      <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label={worte.einstellungen.bereiche}
          className="self-start lg:sticky lg:top-6 lg:border-s lg:border-[var(--border)]"
        >
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col lg:gap-0">
            {GRUPPEN.map((g) => (
              <li key={g.id}>
                <a
                  href={`#${g.id}`}
                  className="block py-1 text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline lg:-ms-px lg:border-s lg:border-transparent lg:ps-3 lg:hover:border-[var(--fg-muted)]"
                >
                  {gruppen[g.id]}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-10">
          {GRUPPEN.map((g) => (
            <section key={g.id} id={g.id} className="scroll-mt-6 space-y-3">
              <h2 className="flex items-center gap-1.5 text-lg font-medium tracking-tight">
                {gruppen[g.id]}
                <Hinweis text={gruppen[`${g.id}Text`]} />
              </h2>
              <Inhalt gruppe={g} eigeneId={eigeneId} />
            </section>
          ))}
        </div>
      </div>
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
          <Logo />
          <Tabellen />
        </div>
      );
    case "anzeigen":
      return <Anzeigen />;
    case "zugaenge":
      return <Zugaenge eigeneId={eigeneId} />;
    default:
      return null;
  }
}
