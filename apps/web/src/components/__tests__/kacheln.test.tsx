/**
 * Das Sinnbild einer Kachel: drei Viertel der Inhaltshöhe, vertikal mittig.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Kacheln } from "@/components/kacheln";

describe("Kacheln", () => {
  it("zeigt das Sinnbild in drei Vierteln der Höhe, vertikal zentriert", () => {
    render(<Kacheln eintraege={[{ pfad: "/kpi", name: "KPI-Dashboard", marke: "Verwalten" }]} />);
    const bild = screen.getByRole("link", { name: /KPI-Dashboard/ }).querySelector("svg");
    expect(bild?.getAttribute("class")).toContain("h-3/4");
    expect(bild?.parentElement?.className).toContain("items-center");
  });
});
