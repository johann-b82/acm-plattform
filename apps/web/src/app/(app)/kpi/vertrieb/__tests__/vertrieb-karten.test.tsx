/**
 * Vertrieb: Vertriebsaktivität zwei Diagramme je Zeile, und die Legende des
 * Kundenanteils trägt nur Farbe und Namen — keine Nummer, keinen Betrag.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/kpi/vertrieb", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/kpi/vertrieb")>();
  return {
    ...echt,
    vertriebApi: {
      ...echt.vertriebApi,
      aktivitaet: async () => [
        {
          iso_jahr: 2026,
          iso_woche: 2,
          erfasser: "Anna",
          erstkontakte: 3,
          besuche_ort: 1,
          besuche_onl: 1,
          angebote_eur: 1000,
          auftraege_eur: 2000,
        },
      ],
      interessenten: async () => [],
    },
  };
});
vi.mock("@/lib/zielwerte", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/zielwerte")>();
  return { ...echt, ladeZielwerte: async () => [] };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { AktivitaetKarte } from "../aktivitaet-karte";
import { KundenanteilDiagramm } from "../kundenanteil-diagramm";

function mitAnbietern(inhalt: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">{inhalt}</SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Vertriebsaktivität", () => {
  it("stellt höchstens zwei Diagramme in eine Zeile", async () => {
    const { container } = mitAnbietern(<AktivitaetKarte von="2026-01-01" bis="2026-03-31" />);
    await screen.findByText("Erstkontakte");
    const raster = container.querySelector("section > .grid");
    expect(raster?.className).toContain("lg:grid-cols-2");
    expect(raster?.className).not.toMatch(/grid-cols-[3-9]/);
  });
});

describe("Kundenanteil, Zeilen", () => {
  const KUNDEN = [
    { kunde: "Diehl Aviation", wert: 3_389_006, anteil: 69.1 },
    { kunde: "Ethiopian Airlines", wert: 416_272, anteil: 8.5 },
    { kunde: "B/E Aerospace", wert: 364_516, anteil: 7.4 },
    { kunde: "Rest A", wert: 500_000, anteil: 10 },
    { kunde: "Rest B", wert: 236_491, anteil: 5 },
  ];

  function zeige() {
    return mitAnbietern(
      <KundenanteilDiagramm
        titel="Kundenanteil Aufträge"
        hinweis="Auftragswerte je Kunde"
        kunden={KUNDEN}
        laedt={false}
        farben={new Map([["Diehl Aviation", 0], ["Ethiopian Airlines", 1], ["B/E Aerospace", 2]])}
      />,
    );
  }

  it("stellt den Namen in die Zeile, nicht in eine Legende", () => {
    // Bei vierzehn Kunden trügen ab dem neunten alle denselben Grauton — mehr
    // als acht Farben sind nicht sicher unterscheidbar. Der Name in der Zeile
    // macht die Zuordnung unabhängig von der Farbe.
    const { container } = zeige();
    const zeilen = within(container.querySelector("ol")!).getAllByRole("listitem");
    // `Intl` setzt ein geschütztes Leerzeichen vor das Prozentzeichen.
    expect(zeilen.map((li) => li.textContent?.replace(/ /g, " "))).toEqual([
      "Diehl Aviation69,1 %",
      "Ethiopian Airlines8,5 %",
      "B/E Aerospace7,4 %",
      "Restkunden (2)15 %",
    ]);
  });

  it("zeichnet die Balken eckig und im Verhältnis zum größten", () => {
    const { container } = zeige();
    const balken = container.querySelectorAll("ol li > span[data-balken] > span");
    expect(balken).toHaveLength(4);
    expect((balken[0] as HTMLElement).style.width).toBe("100%");
    // 416.272 von 3.389.006
    expect((balken[1] as HTMLElement).style.width).toMatch(/^12\./);
    for (const b of balken) expect((b as HTMLElement).className).not.toMatch(/rounded/);
  });

  it("hängt den Betrag an den Balken", () => {
    const { container } = zeige();
    const erster = container.querySelector("ol li > span[data-balken]") as HTMLElement;
    expect(erster.title).toContain("Diehl Aviation");
    expect(erster.title).toMatch(/3\.389\.006|3,4|3.389/);
  });
});
