/**
 * `Seitenwerkzeuge`: in der Schale in die rechte Leiste, ohne Schale an Ort
 * und Stelle — damit eine Seite außerhalb der Schale (etwa im
 * Komponententest) ihre Bedienung behält.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { Seitenwerkzeuge, Werkzeug, Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";

describe("Seitenwerkzeuge", () => {
  it("zeigt die Kinder ohne Schale an Ort und Stelle", () => {
    const { container } = render(
      <div data-testid="seite">
        <Seitenwerkzeuge kategorie="aktionen">
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
          <Seitenwerkzeuge kategorie="aktionen">
            <button type="button">Neues Audit</button>
          </Seitenwerkzeuge>
        </div>
      </Werkzeugplatz.Provider>,
    );
    expect(platz).toContainElement(screen.getByRole("button", { name: "Neues Audit" }));
    platz.remove();
  });

  it("stellt die Kinder in den Platz ihrer Kategorie, wenn die Leiste gegliedert ist", () => {
    const filter = document.createElement("div");
    const aktionen = document.createElement("div");
    document.body.append(filter, aktionen);
    render(
      <Werkzeugplatz.Provider value={{ filter, aktionen }}>
        <Seitenwerkzeuge kategorie="aktionen">
          <button type="button">Neues Audit</button>
        </Seitenwerkzeuge>
        <Seitenwerkzeuge kategorie="filter">
          <Werkzeug titel="Status">
            <select aria-label="Status" />
          </Werkzeug>
        </Seitenwerkzeuge>
      </Werkzeugplatz.Provider>,
    );
    expect(aktionen).toContainElement(screen.getByRole("button", { name: "Neues Audit" }));
    expect(filter).toContainElement(screen.getByRole("combobox", { name: "Status" }));
    // In der Leiste trägt jedes Werkzeug seine Beschriftung.
    expect(filter).toHaveTextContent("Status");
    filter.remove();
    aktionen.remove();
  });

  it("zeigt ohne Schale keine zusätzliche Beschriftung", () => {
    const { container } = render(
      <Seitenwerkzeuge kategorie="filter">
        <Werkzeug titel="Status">
          <select aria-label="Filter-Auswahl" />
        </Werkzeug>
      </Seitenwerkzeuge>,
    );
    expect(container).not.toHaveTextContent("Status");
  });

  it("rendert auf dem Server, wo es kein HTMLElement gibt", () => {
    // Die Schale reicht beim ersten Durchlauf noch leere Plätze; auf dem Server
    // ist `HTMLElement` nicht definiert — ein `instanceof` darauf brach dort ab.
    vi.stubGlobal("HTMLElement", undefined);
    try {
      expect(() =>
        renderToString(
          <Werkzeugplatz.Provider value={{}}>
            <Seitenwerkzeuge kategorie="aktionen">
              <button type="button">Neues Audit</button>
            </Seitenwerkzeuge>
          </Werkzeugplatz.Provider>,
        ),
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("zeichnet in der Schale nichts, solange der Platz noch nicht eingehängt ist", () => {
    render(
      <Werkzeugplatz.Provider value={null}>
        <Seitenwerkzeuge kategorie="aktionen">
          <button type="button">Neues Audit</button>
        </Seitenwerkzeuge>
      </Werkzeugplatz.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Neues Audit" })).toBeNull();
  });
});
