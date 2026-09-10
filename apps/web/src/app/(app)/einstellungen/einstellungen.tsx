"use client";

import { sichtbareGruppen, type Gruppe } from "@/lib/einstellungen";
import { hasLevel, type Apps } from "@/lib/rechte";
import { EmptyState } from "@/components/ui/primitives";

import { Kennzahlen } from "./abschnitte/kennzahlen";
import { Personal } from "./abschnitte/personal";
import { AtrVorlagen } from "./abschnitte/atr-vorlagen";
import { Eingangsordner } from "./abschnitte/atr-eingangsordner";
import { Zugaenge } from "./abschnitte/zugaenge";

/**
 * Alle Einstellungen an einer Stelle, nach Bereich gruppiert.
 *
 * Vorher lag jede Einstellung dort, wo sie fachlich hingehörte — die
 * ATR-Vorlagen im Teilekatalog, der Eingangsordner unter den Lieferungen, die
 * Konten in einer eigenen Verwaltung. Wer etwas einstellen wollte, musste
 * wissen, wo. Jetzt gibt es einen Ort und eine Gliederung.
 *
 * Welche Gruppen jemand sieht, entscheidet das App-Recht — dasselbe, mit dem
 * die Datenbank die Zeilen herausgibt. Ändern ist eine zweite Frage und steckt
 * je Abschnitt in den Policies.
 */
export function Einstellungen({ apps, eigeneId }: { apps: Apps; eigeneId: string }) {
  const gruppen = sichtbareGruppen(apps);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
          Was die Plattform für dich rechnet, holt und zeigt. Gruppiert nach
          Bereich; du siehst, was zu deinen Apps gehört.
        </p>
      </div>

      {gruppen.length === 0 ? (
        <EmptyState
          title="Hier gibt es für dich nichts einzustellen"
          body="Einstellungen erscheinen mit der App, zu der sie gehören. Bitte an die Plattform-Verwaltung wenden."
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
          <nav
            aria-label="Bereiche"
            className="self-start lg:sticky lg:top-6 lg:border-l lg:border-[var(--border)]"
          >
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col lg:gap-0">
              {gruppen.map((g) => (
                <li key={g.id}>
                  <a
                    href={`#${g.id}`}
                    className="block py-1 text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline lg:-ml-px lg:border-l lg:border-transparent lg:pl-3 lg:hover:border-[var(--fg-muted)]"
                  >
                    {g.titel}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-10">
            {gruppen.map((g) => (
              <section key={g.id} id={g.id} className="scroll-mt-6 space-y-3">
                <div>
                  <h2 className="text-lg font-medium tracking-tight">{g.titel}</h2>
                  <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
                    {g.beschreibung}
                  </p>
                </div>
                <Inhalt gruppe={g} apps={apps} eigeneId={eigeneId} />
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Inhalt({
  gruppe,
  apps,
  eigeneId,
}: {
  gruppe: Gruppe;
  apps: Apps;
  eigeneId: string;
}) {
  switch (gruppe.id) {
    case "kennzahlen":
      return <Kennzahlen darfAendern={hasLevel(apps, "settings", "editor")} />;
    case "personal":
      return <Personal darfAendern={hasLevel(apps, "settings", "editor")} />;
    case "atr":
      return (
        <div className="space-y-4">
          <AtrVorlagen darfSchreiben={hasLevel(apps, "atr", "editor")} />
          <Eingangsordner
            darfSchreiben={hasLevel(apps, "atr", "editor")}
            darfEinrichten={hasLevel(apps, "platform", "admin")}
          />
        </div>
      );
    case "zugaenge":
      return <Zugaenge eigeneId={eigeneId} />;
    default:
      return null;
  }
}
