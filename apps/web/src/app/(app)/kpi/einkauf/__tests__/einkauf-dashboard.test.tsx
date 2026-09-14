/**
 * Einkauf im DOM: Reihenfolge der Seite (EIN-03), Mengenspalte, beide
 * Tabellen vollständig über Seiten, Balken/Fläche am Verlauf (VER-04B).
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/lib/zielwerte", async (original) => ({
  ...(await original<typeof import("@/lib/zielwerte")>()),
  ladeZielwerte: async () => [],
}));
vi.mock("@/components/kpi/datenstand", () => ({ Datenstand: () => null }));
vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/kpi/einkauf", async (original) => {
  const echt = await original<typeof import("@/lib/kpi/einkauf")>();
  return {
    ...echt,
    einkaufApi: {
      otd: async () => ({ quote: 0.25, puenktlich: 1, gesamt: 4, verzug_schnitt: 3 }),
      verlauf: async () => [{ bucket: "2026-01-01", quote: 0.5, puenktlich: 1, gesamt: 2 }],
      positionen: async () =>
        Array.from({ length: 30 }, (_, i) => ({
          auftrag: `A-${i}`,
          pos: 10,
          upos: 0,
          adr_nr: "70123",
          supplier_name: "Weber",
          article_number: "X-1",
          article_name: "Schraube",
          target_date: "2026-01-10",
          delivered_date: "2026-01-12",
          verzug_tage: 2,
          quantity: 12.6,
          unit: "STK",
        })),
    },
    ladenhueterApi: {
      alle: async () =>
        Array.from({ length: 30 }, (_, i) => ({
          artnr: `L-${i}`,
          article_name: "Teil",
          bestand: 10,
          letzte_bewegung: "2026-01-01",
          tage_liegend: 90,
          stueckpreis: 1,
          wert: 10,
        })),
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { EinkaufDashboard } from "../einkauf-dashboard";

function zeige() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SprachAnbieter sprache="de">
        <EinkaufDashboard />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Einkauf-Seite", () => {
  it("zeigt keinen erklärenden Satz über der Seite", () => {
    zeige();
    expect(screen.queryByText("Liefertermintreue der Lieferanten. Gezählt wird, was im Zeitraum angekommen ist.")).toBeNull();
  });

  it("ordnet Verlauf → Lieferpositionen → Lager", async () => {
    zeige();
    const verlauf = await screen.findByRole("heading", { name: "OTD-Quote im Zeitverlauf" });
    const positionen = await screen.findByRole("heading", { name: "Lieferpositionen" });
    const lager = await screen.findByRole("heading", { name: /Ladenhüter/ });
    expect(verlauf.compareDocumentPosition(positionen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(positionen.compareDocumentPosition(lager) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("zeigt die Lieferpositionen mit Menge ohne Nachkommastellen und Adress-Nr.", async () => {
    zeige();
    const tabelle = await screen.findByRole("table", { name: "Lieferpositionen" });
    const koepfe = within(tabelle).getAllByRole("columnheader").map((k) => k.textContent);
    expect(koepfe).toEqual(["Auftrag", "Lieferant", "Artikel", "Geliefert", "Zieltermin", "Verzug", "Menge"]);
    const ersteZeile = within(tabelle).getAllByRole("row")[1];
    expect(ersteZeile).toHaveTextContent("13 STK");
    expect(ersteZeile).toHaveTextContent("(70123)");
  });

  it("macht beide Tabellen durchsuchbar und blätterbar", async () => {
    zeige();
    await screen.findByRole("table", { name: "Lieferpositionen" });
    await waitFor(() => expect(screen.getAllByRole("searchbox")).toHaveLength(2));
    expect(screen.getAllByText("1–25 von 30")).toHaveLength(2);
  });

  it("bietet am Verlauf Balken und Fläche an", async () => {
    zeige();
    const wahl = await screen.findByRole("radiogroup", { name: "Darstellung" });
    expect(within(wahl).getByRole("radio", { name: "Balken" })).toHaveAttribute("aria-checked", "true");
    expect(within(wahl).getByRole("radio", { name: "Fläche" })).toBeInTheDocument();
  });
});
