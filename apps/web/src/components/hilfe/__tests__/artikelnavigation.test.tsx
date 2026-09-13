/**
 * Die seitliche Artikelnavigation der Hilfe (HIL-01): alle Themen, nach der
 * bestehenden Gruppierung, der aktuelle Artikel markiert — breit als Leiste,
 * schmal oben und einklappbar.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { GRUPPEN } from "@/hilfe/registry";
import { Artikelnavigation } from "@/components/hilfe/artikelnavigation";

const BESCHRIFTUNG = { navigation: "Hilfethemen", alleThemen: "← Alle Themen" };

describe("Artikelnavigation", () => {
  const aktuell = GRUPPEN[1].seiten[0];

  it("führt jede Gruppe und jeden Artikel, nicht nur die eigene Gruppe", () => {
    render(<Artikelnavigation aktuell={aktuell.slug} beschriftung={BESCHRIFTUNG} />);
    const leiste = screen.getByRole("navigation", { name: "Hilfethemen" });
    for (const gruppe of GRUPPEN) {
      expect(within(leiste).getByText(gruppe.titel)).toBeTruthy();
      for (const seite of gruppe.seiten) {
        const link = within(leiste).getByRole("link", { name: seite.titel });
        expect(link.getAttribute("href")).toBe(`/hilfe/${seite.slug}`);
      }
    }
  });

  it("markiert genau den aktuellen Artikel", () => {
    render(<Artikelnavigation aktuell={aktuell.slug} beschriftung={BESCHRIFTUNG} />);
    const leiste = screen.getByRole("navigation", { name: "Hilfethemen" });
    const markiert = within(leiste)
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(markiert.map((l) => l.textContent)).toEqual([aktuell.titel]);
  });

  it("ist schmal einklappbar, mit dem aktuellen Artikel in der Zusammenfassung", () => {
    const { container } = render(
      <Artikelnavigation aktuell={aktuell.slug} beschriftung={BESCHRIFTUNG} />,
    );
    const klappe = container.querySelector("details");
    expect(klappe).not.toBeNull();
    expect(klappe!.hasAttribute("open")).toBe(false);
    expect(klappe!.querySelector("summary")!.textContent).toContain(aktuell.titel);
  });

  it("führt zurück zur Themenübersicht", () => {
    render(<Artikelnavigation aktuell={aktuell.slug} beschriftung={BESCHRIFTUNG} />);
    const leiste = screen.getByRole("navigation", { name: "Hilfethemen" });
    expect(within(leiste).getByRole("link", { name: "← Alle Themen" }).getAttribute("href")).toBe("/hilfe");
  });
});
