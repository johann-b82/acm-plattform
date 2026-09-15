/**
 * Das Sinnbild einer Kachel: klein, oben rechts in der Ecke.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Kacheln } from "@/components/kacheln";

describe("Kacheln", () => {
  it("zeigt das Sinnbild klein und in fester Größe", () => {
    render(<Kacheln eintraege={[{ pfad: "/kpi", name: "KPI-Dashboard", marke: "Verwalten" }]} />);
    const bild = screen.getByRole("link", { name: /KPI-Dashboard/ }).querySelector("svg");
    const klassen = bild?.getAttribute("class") ?? "";
    // 22,5 px: erst 20 px, dann 50 % größer (30 px), dann 25 % kleiner.
    expect(klassen).toContain("h-[1.40625rem]");
    expect(klassen).toContain("w-[1.40625rem]");
    expect(klassen).not.toContain("h-[3.1875rem]");
  });

  it("setzt das Sinnbild oben rechts in die Ecke, ohne dass der Text darunter läuft", () => {
    render(<Kacheln eintraege={[{ pfad: "/kpi", name: "KPI-Dashboard", marke: "Verwalten" }]} />);
    const link = screen.getByRole("link", { name: /KPI-Dashboard/ });
    const bild = link.querySelector("svg")!;
    expect(link.className).toContain("relative");
    const ecke = bild.parentElement!;
    expect(ecke.className).toContain("absolute");
    expect(ecke.className).toMatch(/\btop-\d/);
    expect(ecke.className).toMatch(/\bend-\d/);
    // Der Name hält Abstand zur Ecke.
    expect(screen.getByText("KPI-Dashboard").className).toMatch(/\bpe-\d/);
  });

  it("gibt allen Kacheln dieselbe, begrenzte Breite statt fester Spaltenzahl", () => {
    render(<Kacheln eintraege={[{ pfad: "/kpi", name: "KPI-Dashboard" }]} />);
    const raster = screen.getByRole("list");
    expect(raster.className).toContain("auto-fill");
    expect(raster.className).not.toMatch(/grid-cols-\d/);
  });
});
