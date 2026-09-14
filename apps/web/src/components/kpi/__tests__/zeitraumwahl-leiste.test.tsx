/**
 * Die Zeitraumwahl in der rechten Leiste: dort ist sie so breit wie die
 * Leiste, und der Datenstand bricht um, statt nach links über den Rand zu
 * ragen. Ohne Schale bleibt sie rechtsbündig mit überstehendem Datenstand.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Zeitraumwahl, type Zeitraumwahl as Wahl } from "@/components/kpi/zeitraumwahl";

const WAHL: Wahl = {
  zeitraum: "jahr",
  setZeitraum: vi.fn(),
  frei: { von: "2026-01-01", bis: "2026-09-14" },
  setFrei: vi.fn(),
  von: "2026-01-01",
  bis: "2026-12-31",
  verdreht: false,
};

function zeige(inSchale: boolean) {
  const wahl = <Zeitraumwahl wahl={WAHL} datenstand={<span>Personio-Abgleich 11.09.26, 04:02</span>} />;
  // In der Schale zeichnet sie in den Platz der Leiste — ein eingehängtes Element.
  const platz = document.createElement("div");
  document.body.appendChild(platz);
  return render(
    <SprachAnbieter sprache="de">
      {inSchale ? <Werkzeugplatz.Provider value={platz}>{wahl}</Werkzeugplatz.Provider> : wahl}
    </SprachAnbieter>,
    { baseElement: document.body },
  );
}

describe("Zeitraumwahl", () => {
  it("füllt in der rechten Leiste die Breite, der Datenstand bricht um", () => {
    zeige(true);
    expect(screen.getByDisplayValue("Dieses Jahr").className).toContain("w-full");
    const stand = document.querySelector("[data-datenstand]")!;
    expect(stand.className).not.toContain("w-0");
    expect(stand.className).not.toContain("whitespace-nowrap");
  });

  it("stellt sich in der gegliederten Leiste selbst unter „Zeitraum“", () => {
    const zeitraum = document.createElement("div");
    const aktionen = document.createElement("div");
    document.body.append(zeitraum, aktionen);
    render(
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={{ zeitraum, aktionen }}>
          <Zeitraumwahl wahl={WAHL} datenstand={<span>Datenstand 13.07.26</span>} />
        </Werkzeugplatz.Provider>
      </SprachAnbieter>,
    );
    expect(zeitraum).toContainElement(screen.getByDisplayValue("Dieses Jahr"));
    expect(zeitraum).toHaveTextContent("Datenstand 13.07.26");
    expect(aktionen).toBeEmptyDOMElement();
    zeitraum.remove();
    aktionen.remove();
  });

  it("bleibt ohne Schale rechtsbündig mit überstehendem Datenstand", () => {
    const { container } = zeige(false);
    expect(screen.getByDisplayValue("Dieses Jahr").className).toContain("w-48");
    expect(container.querySelector("[data-datenstand]")!.className).toContain("w-0");
  });
});
