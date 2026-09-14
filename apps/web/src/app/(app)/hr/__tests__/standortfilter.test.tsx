/**
 * Der Standortfilter: ohne Schale trägt er seine Beschriftung neben den Chips,
 * in der rechten Leiste steht sie schon als Titel darüber und entfällt hier.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Standortfilter } from "../standortfilter";

const PROPS = {
  standorte: ["Berlin", "Hamburg"],
  gewaehlt: new Set<string>(),
  onToggle: vi.fn(),
  beschriftung: "Standort",
};

describe("Standortfilter", () => {
  it("zeigt ohne Schale seine Beschriftung neben den Chips", () => {
    const { container } = render(<Standortfilter {...PROPS} />);
    expect(container).toHaveTextContent("Standort");
  });

  it("verzichtet in der Leiste auf die eigene Beschriftung, der Name bleibt", () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    const { container } = render(
      <Werkzeugplatz.Provider value={platz}>
        <Standortfilter {...PROPS} />
      </Werkzeugplatz.Provider>,
    );
    expect(container).not.toHaveTextContent("Standort");
    expect(screen.getByRole("group", { name: "Standort" })).toBeInTheDocument();
    platz.remove();
  });
});
