/**
 * Der Seitenkopf ohne Schale — etwa in Komponententests oder einer Ansicht
 * ohne rechte Leiste: Umschalter und Bedienung bleiben dann im Kopf stehen.
 * In der Schale wandern sie in die rechte Leiste (siehe schale.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Seitenkopf } from "@/components/seitenkopf";

describe("Seitenkopf ohne rechte Leiste", () => {
  it("zeigt Satz, Umschalter und Bedienung an Ort und Stelle", () => {
    const { container } = render(
      <Seitenkopf
        untertitel="Satz"
        links={<button type="button">Umschalter</button>}
        bedienung={<button type="button">Zeitraum</button>}
      />,
    );
    expect(screen.getByText("Satz")).toBeInTheDocument();
    expect(container).toContainElement(screen.getByRole("button", { name: "Umschalter" }));
    expect(container).toContainElement(screen.getByRole("button", { name: "Zeitraum" }));
  });
});
