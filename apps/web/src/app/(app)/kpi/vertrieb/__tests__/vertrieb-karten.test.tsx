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

describe("Kundenanteil, Legende", () => {
  it("zeigt nur die Namen, ohne Nummer und Betrag", () => {
    const { container } = mitAnbietern(
      <KundenanteilDiagramm
        titel="Kundenanteil Aufträge"
        hinweis="Auftragswerte je Kunde"
        kunden={[
          { kunde: "Diehl Aviation", wert: 3_389_006, anteil: 69.1 },
          { kunde: "Ethiopian Airlines", wert: 416_272, anteil: 8.5 },
          { kunde: "B/E Aerospace", wert: 364_516, anteil: 7.4 },
          { kunde: "Rest A", wert: 500_000, anteil: 10 },
          { kunde: "Rest B", wert: 236_491, anteil: 5 },
        ]}
        laedt={false}
        farben={new Map([["Diehl Aviation", 0], ["Ethiopian Airlines", 1], ["B/E Aerospace", 2]])}
      />,
    );
    const legende = within(container.querySelector("ol")!);
    const eintraege = legende.getAllByRole("listitem").map((li) => li.textContent);
    expect(eintraege).toEqual(["Diehl Aviation", "Ethiopian Airlines", "B/E Aerospace", "Restkunden (2)"]);
  });
});
