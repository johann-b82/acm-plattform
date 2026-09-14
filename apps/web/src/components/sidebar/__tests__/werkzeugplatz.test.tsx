/**
 * `Seitenwerkzeuge`: in der Schale in die rechte Leiste, ohne Schale an Ort
 * und Stelle — damit eine Seite außerhalb der Schale (etwa im
 * Komponententest) ihre Bedienung behält.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Seitenwerkzeuge, Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";

describe("Seitenwerkzeuge", () => {
  it("zeigt die Kinder ohne Schale an Ort und Stelle", () => {
    const { container } = render(
      <div data-testid="seite">
        <Seitenwerkzeuge>
          <button type="button">Neues Audit</button>
        </Seitenwerkzeuge>
      </div>,
    );
    expect(container.querySelector('[data-testid="seite"]')).toContainElement(
      screen.getByRole("button", { name: "Neues Audit" }),
    );
  });

  it("stellt die Kinder in der Schale in den Platz der rechten Leiste", () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    render(
      <Werkzeugplatz.Provider value={platz}>
        <div data-testid="seite">
          <Seitenwerkzeuge>
            <button type="button">Neues Audit</button>
          </Seitenwerkzeuge>
        </div>
      </Werkzeugplatz.Provider>,
    );
    expect(platz).toContainElement(screen.getByRole("button", { name: "Neues Audit" }));
    platz.remove();
  });

  it("zeichnet in der Schale nichts, solange der Platz noch nicht eingehängt ist", () => {
    render(
      <Werkzeugplatz.Provider value={null}>
        <Seitenwerkzeuge>
          <button type="button">Neues Audit</button>
        </Seitenwerkzeuge>
      </Werkzeugplatz.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Neues Audit" })).toBeNull();
  });
});
