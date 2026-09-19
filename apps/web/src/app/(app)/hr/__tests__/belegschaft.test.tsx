/**
 * Die Verteilungen der Belegschaft: jede Zeile trägt die absolute Anzahl und
 * den Anteil in Klammern — bei Geschlecht, Beschäftigungsart und Abteilungen.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/kpi/personal", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/kpi/personal")>();
  return {
    ...echt,
    personalApi: {
      belegschaft: async () => null,
      kompetenz: async () => null,
      verteilung: async () => [
        { art: "geschlecht", kategorie: "maennlich", anzahl: 3 },
        { art: "geschlecht", kategorie: "weiblich", anzahl: 1 },
        { art: "beschaeftigung", kategorie: "vollzeit", anzahl: 46 },
        { art: "beschaeftigung", kategorie: "extern", anzahl: 4 },
        { art: "abteilung", kategorie: "Production", anzahl: 9 },
        { art: "abteilung", kategorie: "IT", anzahl: 1 },
      ],
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Belegschaft } from "../belegschaft";

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <Belegschaft />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Belegschaft, Verteilungen", () => {
  it("zeigt überall die Anzahl und den Anteil in Klammern", async () => {
    zeige();
    expect(await screen.findByText("3 (75 %)")).toBeInTheDocument();
    expect(screen.getByText("1 (25 %)")).toBeInTheDocument();
    expect(screen.getByText("46 (92 %)")).toBeInTheDocument();
    expect(screen.getByText("4 (8 %)")).toBeInTheDocument();
    expect(screen.getByText("9 (90 %)")).toBeInTheDocument();
    expect(screen.getByText("1 (10 %)")).toBeInTheDocument();
  });

  it("weist auf den heutigen Stand hin — Personio führt keine Historie", async () => {
    zeige();
    expect(await screen.findByText(/keine Historie/)).toBeInTheDocument();
  });
});
