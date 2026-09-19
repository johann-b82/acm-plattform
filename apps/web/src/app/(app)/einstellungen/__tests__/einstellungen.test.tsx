/**
 * Die Einstellungen wählen ihren Bereich über ein Auswahlmenü; darunter steht
 * nur der gewählte Abschnitt. In der Schale steht das Menü in der rechten
 * Leiste.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

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

const worte = texteFuer("de");
const gruppen = worte.einstellungen.gruppen as Record<string, string>;

afterEach(() => {
  history.replaceState(null, "", " ");
});

function zeigeInSchale() {
  const plaetze = Object.fromEntries(
    ["navigation", "ansicht", "filter", "zeitraum", "aktionen"].map((k) => [
      k,
      document.body.appendChild(document.createElement("div")),
    ]),
  );
  const ergebnis = render(
    <SprachAnbieter sprache="de">
      <Werkzeugplatz.Provider value={plaetze}>
        <Einstellungen eigeneId="u1" />
      </Werkzeugplatz.Provider>
    </SprachAnbieter>,
  );
  return { ...ergebnis, plaetze };
}

describe("Einstellungen in Kategorien", () => {
  it("stellt das Bereichsmenü in der Schale in die rechte Leiste, mit allen Kategorien", () => {
    const { plaetze } = zeigeInSchale();
    const menu = screen.getByRole("combobox", { name: "Bereiche" });
    expect(plaetze.navigation).toContainElement(menu);
    expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual(
      GRUPPEN.map((g) => gruppen[g.id]),
    );
    Object.values(plaetze).forEach((div) => div.remove());
  });

  it("zeigt nur den gewählten Bereich, nicht alle auf einmal", () => {
    const { container, plaetze } = zeigeInSchale();
    // Voreinstellung ist der erste Bereich.
    expect(container.querySelector(`section#${GRUPPEN[0].id}`)).not.toBeNull();
    expect(container.querySelector("section#sensoren")).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Bereiche" }), {
      target: { value: "sensoren" },
    });
    expect(container.querySelector("section#sensoren")).not.toBeNull();
    expect(container.querySelector(`section#${GRUPPEN[0].id}`)).toBeNull();
    Object.values(plaetze).forEach((div) => div.remove());
  });

  it("nimmt die Kategorie aus der Adresse (etwa die Weiterleitung von /platform)", () => {
    history.replaceState(null, "", "#zugaenge");
    const { container, plaetze } = zeigeInSchale();
    expect(container.querySelector("section#zugaenge")).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "Bereiche" })).toHaveValue("zugaenge");
    Object.values(plaetze).forEach((div) => div.remove());
  });
});
