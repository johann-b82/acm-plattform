/**
 * Die Qualitätsseite im DOM: der Filter Auditart steht in derselben Zeile wie
 * der Umschalter Audits/Reklamationen/Qualitätsprüfung und nur bei Audits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/kpi/qualitaet", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/kpi/qualitaet")>();
  return {
    ...echt,
    qualitaetApi: {
      audits: vi.fn(async () => ({ level_1: 0, level_2: 0, ohne_level: 0 })),
      verlauf: vi.fn(async () => []),
      liste: vi.fn(async () => []),
    },
    pruefungApi: {
      mengen: vi.fn(async () => []),
      verlauf: vi.fn(async () => []),
      buchungen: vi.fn(async () => []),
    },
    reklamationApi: {
      quote: vi.fn(async () => null),
      verlauf: vi.fn(async () => []),
      liste: vi.fn(async () => []),
    },
  };
});
vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/components/kpi/datenstand", () => ({ Datenstand: () => null }));
vi.mock("@/lib/zielwerte", () => ({
  ladeZielwerte: async () => [],
  nachSchluessel: () => ({}),
  zielwerteKeys: { alle: () => ["zielwerte"] },
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { QualitaetDashboard } from "../qualitaet-dashboard";

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <QualitaetDashboard />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Qualität", () => {
  it("stellt die Auditart in dieselbe Zeile wie den Umschalter der Ansicht", () => {
    zeige();
    const umschalter = screen.getByRole("radiogroup", { name: "Ansicht" });
    const zeile = umschalter.parentElement!;
    expect(within(zeile).getByText("Auditart:")).toBeInTheDocument();
    expect(within(zeile).getByRole("button", { name: "Behörde" })).toBeInTheDocument();
  });

  it("stellt bei der Qualitätsprüfung die Artikelart in dieselbe Zeile wie den Umschalter", () => {
    zeige();
    const umschalter = screen.getByRole("radiogroup", { name: "Ansicht" });
    fireEvent.click(within(umschalter).getByRole("radio", { name: "Qualitätsprüfung" }));
    const artikelart = screen.getByRole("radio", { name: "Fertigartikel" }).closest('[role="radiogroup"]');
    expect(artikelart?.parentElement).toBe(umschalter.parentElement);
  });

  it("stellt die Reklamationsart in der Schale in die rechte Leiste, die Mengenart bleibt an der Kachel", () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <QualitaetDashboard />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    fireEvent.click(within(platz).getByRole("radio", { name: "Reklamationen" }));
    fireEvent.click(within(platz).getByRole("button", { name: "intern" }));
    expect(within(platz).getByRole("button", { name: "intern" })).toHaveAttribute("aria-pressed", "true");
    expect(within(platz).queryByRole("button", { name: "gemeldete Menge" })).toBeNull();
    expect(screen.getByRole("button", { name: "gemeldete Menge" })).toBeInTheDocument();
    platz.remove();
  });

  describe("in der Schale mit Kategorien", () => {
    function zeigeInSchale() {
      const plaetze = {
        navigation: document.createElement("div"),
        ansicht: document.createElement("div"),
        filter: document.createElement("div"),
        zeitraum: document.createElement("div"),
        aktionen: document.createElement("div"),
      };
      Object.values(plaetze).forEach((p) => document.body.appendChild(p));
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <SprachAnbieter sprache="de">
            <Werkzeugplatz.Provider value={plaetze}>
              <QualitaetDashboard />
            </Werkzeugplatz.Provider>
          </SprachAnbieter>
        </QueryClientProvider>,
      );
      return plaetze;
    }

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("stellt den Umschalter mit Titel in die Ansicht, die Auditart mit Titel in die Filter", () => {
      const { ansicht, filter } = zeigeInSchale();
      expect(within(ansicht).getByRole("radiogroup", { name: "Ansicht" })).toBeInTheDocument();
      expect(within(ansicht).getByText("Ansicht")).toBeInTheDocument();
      expect(within(filter).getByRole("button", { name: "Behörde" })).toBeInTheDocument();
      // Titel ohne Doppelpunkt, keine zweite Beschriftung.
      expect(within(filter).getByText("Auditart")).toBeInTheDocument();
      expect(within(filter).queryByText("Auditart:")).toBeNull();
      expect(within(ansicht).queryByRole("button", { name: "Behörde" })).toBeNull();
    });

    it("stellt die Artikelart mit Titel in die Filter", () => {
      const { ansicht, filter } = zeigeInSchale();
      fireEvent.click(within(ansicht).getByRole("radio", { name: "Qualitätsprüfung" }));
      expect(within(filter).getByRole("radiogroup", { name: "Artikelart" })).toBeInTheDocument();
      expect(within(filter).getByText("Artikelart")).toBeInTheDocument();
      expect(within(ansicht).queryByRole("radiogroup", { name: "Artikelart" })).toBeNull();
    });

    it("stellt die Reklamationsart mit Titel in die Filter", () => {
      const { ansicht, filter } = zeigeInSchale();
      fireEvent.click(within(ansicht).getByRole("radio", { name: "Reklamationen" }));
      expect(within(filter).getByRole("button", { name: "intern" })).toBeInTheDocument();
      expect(within(filter).getByText("Reklamationsart")).toBeInTheDocument();
      expect(within(ansicht).queryByRole("button", { name: "intern" })).toBeNull();
    });
  });

  it("zeigt die Auditart nur bei Audits", () => {
    zeige();
    const umschalter = screen.getByRole("radiogroup", { name: "Ansicht" });
    fireEvent.click(within(umschalter).getByRole("radio", { name: "Reklamationen" }));
    expect(screen.queryByRole("button", { name: "Behörde" })).not.toBeInTheDocument();
  });
});
