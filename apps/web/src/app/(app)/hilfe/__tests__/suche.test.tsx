/**
 * Die Hilfesuche in der Schale: das Suchfeld steht in der rechten Leiste, die
 * Treffer erscheinen weiter im Inhalt.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { texteFuer } from "@/texte";
import { Suche } from "../suche";

describe("Hilfesuche", () => {
  it("stellt das Suchfeld in die Leiste und zeigt die Treffer im Inhalt", () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    render(
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={platz}>
          <main data-testid="inhalt">
            <Suche />
          </main>
        </Werkzeugplatz.Provider>
      </SprachAnbieter>,
    );
    const feld = screen.getByRole("textbox", { name: texteFuer("de").hilfe.suchen });
    expect(platz).toContainElement(feld);

    fireEvent.change(feld, { target: { value: "hochladen" } });
    const treffer = screen.getByRole("link", { name: "Daten hochladen" });
    expect(screen.getByTestId("inhalt")).toContainElement(treffer);
    expect(platz).not.toContainElement(treffer);
    platz.remove();
  });
});
