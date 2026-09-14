/**
 * Produktion im DOM: eine Tabellenfläche mit zwei Ansichten (PRO-02), die
 * Zahl der offenen Aufträge aus SQL, Balken/Fläche am Verlauf (VER-04B).
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("@/lib/kpi/produktion", async (original) => {
  const echt = await original<typeof import("@/lib/kpi/produktion")>();
  return {
    ...echt,
    produktionApi: {
      // Die Liste trägt 30 offene Aufträge, die Summe sagt 7: angezeigt werden
      // muss die Zahl aus SQL, nicht die aus der Liste.
      verzug: async () => ({ quote: 0.8, in_verzug: 31, gesamt: 40, verzug_schnitt: 5, offen: 7 }),
      verlauf: async () => [{ bucket: "2026-01-01", quote: 0.5, in_verzug: 1, gesamt: 2 }],
      liste: async () => [
        { vorgang_nr: "V-1", customer_name: "Müller", adr_nr: "10042", ziel: "2026-01-01", ist: "2026-01-09", verzug_tage: 8, art: "verspaetet" },
        ...Array.from({ length: 30 }, (_, i) => ({
          vorgang_nr: `O-${i}`,
          customer_name: "Weber",
          adr_nr: null,
          ziel: "2026-02-01",
          ist: null,
          verzug_tage: 100 + i,
          art: "offen" as const,
        })),
      ],
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { ProduktionDashboard } from "../produktion-dashboard";

function zeige() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SprachAnbieter sprache="de">
        <ProduktionDashboard />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

const koepfe = (tabelle: HTMLElement) =>
  within(tabelle).getAllByRole("columnheader").map((k) => k.textContent);

describe("Produktion-Seite", () => {
  it("zeigt keinen erklärenden Satz über der Seite", () => {
    zeige();
    expect(screen.queryByText("Aufträge in Verzug. Gezählt wird ein Auftrag erst, wenn sein Ausgang feststeht.")).toBeNull();
  });

  it("nennt die offenen Aufträge aus der SQL-Zählung", async () => {
    zeige();
    expect(await screen.findByText("davon 7 offen und überfällig")).toBeInTheDocument();
  });

  it("startet mit „Aufträge in Verzug“ und zeigt deren Spalten", async () => {
    zeige();
    const wahl = await screen.findByRole("radiogroup", { name: "Auftragsansicht" });
    expect(within(wahl).getByRole("radio", { name: "Aufträge in Verzug" })).toHaveAttribute("aria-checked", "true");
    const tabelle = await screen.findByRole("table", { name: "Aufträge in Verzug" });
    expect(koepfe(tabelle)).toEqual(["Auftrag", "Kunde", "Zieltermin", "Geliefert", "Verzug"]);
    expect(within(tabelle).getAllByRole("row")).toHaveLength(2);
    expect(within(tabelle).getByText("(10042)")).toBeInTheDocument();
    // Eine Zeile: keine Suche nötig (TAB-03).
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("schaltet auf die überfälligen offenen Aufträge mit eigenen Spalten, Suche und Seiten", async () => {
    zeige();
    const wahl = await screen.findByRole("radiogroup", { name: "Auftragsansicht" });
    fireEvent.click(within(wahl).getByRole("radio", { name: "Überfällige offene Aufträge" }));
    const tabelle = await screen.findByRole("table", { name: "Überfällige offene Aufträge" });
    expect(koepfe(tabelle)).toEqual(["Auftrag", "Kunde", "Zieltermin", "Tage überfällig"]);
    expect(screen.getByText("1–25 von 30")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    // Größter Verzug zuerst.
    expect(within(tabelle).getAllByRole("row")[1]).toHaveTextContent("O-29");
  });

  it("bietet am Verlauf Balken und Fläche an", async () => {
    zeige();
    const wahl = await screen.findByRole("radiogroup", { name: "Darstellung" });
    expect(within(wahl).getByRole("radio", { name: "Fläche" })).toBeInTheDocument();
  });
});
