/**
 * Das Sinnbild einer Kachel: drei Viertel der Inhaltshöhe, vertikal mittig.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Kacheln } from "@/components/kacheln";

describe("Kacheln", () => {
  it("zeigt das Sinnbild in fester Höhe, vertikal zentriert — auch wenn der Text umbricht", () => {
    render(<Kacheln eintraege={[{ pfad: "/kpi", name: "KPI-Dashboard", marke: "Verwalten" }]} />);
    const bild = screen.getByRole("link", { name: /KPI-Dashboard/ }).querySelector("svg");
    // Feste Höhe statt Anteil an der Kachelhöhe: ein umbrechender Name
    // macht die Kachel höher, das Sinnbild darf dabei nicht mitwachsen.
    expect(bild?.getAttribute("class")).toContain("h-[3.1875rem]");
    expect(bild?.getAttribute("class")).not.toContain("h-3/4");
    expect(bild?.parentElement?.className).toContain("items-center");
  });

  it("setzt das Sinnbild an den rechten Rand, hinter den Text", () => {
    render(<Kacheln eintraege={[{ pfad: "/kpi", name: "KPI-Dashboard", marke: "Verwalten" }]} />);
    const link = screen.getByRole("link", { name: /KPI-Dashboard/ });
    expect(link.lastElementChild?.querySelector("svg")).toBeTruthy();
    expect(link.firstElementChild?.querySelector("svg")).toBeNull();
  });

  it("gibt allen Kacheln dieselbe, begrenzte Breite statt fester Spaltenzahl", () => {
    render(<Kacheln eintraege={[{ pfad: "/kpi", name: "KPI-Dashboard" }]} />);
    const raster = screen.getByRole("list");
    expect(raster.className).toContain("auto-fill");
    expect(raster.className).not.toMatch(/grid-cols-\d/);
  });
});
