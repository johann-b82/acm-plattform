/**
 * Die Sprungliste der Einstellungen steht in der Schale in der rechten Leiste,
 * die Gruppen selbst bleiben im Inhalt.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../abschnitte/kennzahlen", () => ({ Kennzahlen: () => null }));
vi.mock("../abschnitte/personal", () => ({ Personal: () => null }));
vi.mock("../abschnitte/personio-zugang", () => ({ PersonioZugang: () => null }));
vi.mock("../abschnitte/atr-vorlagen", () => ({ AtrVorlagen: () => null }));
vi.mock("../abschnitte/atr-eingangsordner", () => ({ Eingangsordner: () => null }));
vi.mock("../abschnitte/logo", () => ({ Logo: () => null }));
vi.mock("../abschnitte/erscheinung", () => ({ Erscheinung: () => null }));
vi.mock("../abschnitte/tabellen", () => ({ Tabellen: () => null }));
vi.mock("../abschnitte/anzeigen", () => ({ Anzeigen: () => null }));
vi.mock("../abschnitte/email", () => ({ Email: () => null }));
vi.mock("../abschnitte/zeugnisse", () => ({ Zeugnisse: () => null }));
vi.mock("../abschnitte/qualitaet", () => ({ Qualitaet: () => null }));
vi.mock("../abschnitte/sensoren", () => ({ Sensoren: () => null }));
vi.mock("../abschnitte/zugaenge", () => ({ Zugaenge: () => null }));
vi.mock("../abschnitte/ad", () => ({ ActiveDirectory: () => null }));

import { GRUPPEN } from "@/lib/einstellungen";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { texteFuer } from "@/texte";
import { Einstellungen } from "../einstellungen";

describe("Einstellungen in der Schale", () => {
  it("stellt die Sprungliste senkrecht in die rechte Leiste", () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    const { container } = render(
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={platz}>
          <Einstellungen eigeneId="u1" />
        </Werkzeugplatz.Provider>
      </SprachAnbieter>,
    );
    const worte = texteFuer("de");
    const nav = screen.getByRole("navigation", { name: worte.einstellungen.bereiche });
    expect(platz).toContainElement(nav);
    expect(nav.querySelector("ul")!.className).toContain("flex-col");
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(
      GRUPPEN.map((g) => `#${g.id}`),
    );
    // Die Abschnitte bleiben im Inhalt.
    for (const g of GRUPPEN) expect(container.querySelector(`section#${g.id}`)).not.toBeNull();
    platz.remove();
  });
});
