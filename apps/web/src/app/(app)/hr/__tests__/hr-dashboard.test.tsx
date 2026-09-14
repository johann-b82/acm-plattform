/**
 * Der Kopf der HR-Kennzahlen: der Satz darüber in einer Zeile, „Jetzt
 * abgleichen“ als Knopf links neben der Zeitraumwahl.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/kpi/personal", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/kpi/personal")>();
  return {
    ...echt,
    personalApi: new Proxy({}, { get: () => async () => null }),
  };
});
vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/lib/zielwerte", () => ({
  ladeZielwerte: async () => [],
  nachSchluessel: () => ({}),
  verfehlt: () => false,
  zielwerteKeys: { alle: () => ["zielwerte"] },
}));
vi.mock("../belegschaft", () => ({ Belegschaft: () => null }));
vi.mock("../mitarbeitertabelle", () => ({ Mitarbeitertabelle: () => null }));
vi.mock("../wochenbericht", () => ({ Wochenbericht: () => null }));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz, type Kategorie } from "@/components/sidebar/werkzeugplatz";
import { PersonalDashboard } from "../hr-dashboard";

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <PersonalDashboard darfAbgleichen />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("HR-Kennzahlen, Kopf", () => {
  it("stellt „Jetzt abgleichen“ als Knopf links neben die Zeitraumwahl", () => {
    zeige();
    const knopf = screen.getByRole("button", { name: "Jetzt abgleichen" });
    const zeitraum = screen.getByDisplayValue("Dieses Jahr");
    const bedienung = knopf.parentElement!;
    expect(bedienung.contains(zeitraum)).toBe(true);
    expect(knopf.compareDocumentPosition(zeitraum) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(knopf.className).toContain("border");
  });

  it("lässt den langen Abgleichstand die Zeitraumwahl nicht verbreitern", () => {
    // Sonst rückt das Auswahlfeld vom Knopf weg: der Abstand soll derselbe
    // sein wie bei Vertrieb, wo der Datenstand kürzer ist als das Feld.
    const { container } = zeige();
    const halter = container.querySelector("[data-datenstand]");
    expect(halter?.className).toContain("w-0");
    expect(halter?.className).toContain("min-w-full");
  });

  it("lässt den Satz über der Seite nicht auf Absatzbreite umbrechen", () => {
    zeige();
    expect(screen.getByText(/Aus dem Personio-Abgleich/).className).not.toContain("max-w-prose");
  });

  it("stellt in der Schale den Abgleich zu den Aktionen und die Zeitraumwahl in den Zeitraum", () => {
    const platzFuer = () => document.body.appendChild(document.createElement("div"));
    const orte: Record<Kategorie, HTMLElement> = {
      navigation: platzFuer(),
      ansicht: platzFuer(),
      filter: platzFuer(),
      zeitraum: platzFuer(),
      aktionen: platzFuer(),
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={orte}>
            <PersonalDashboard darfAbgleichen />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    expect(within(orte.aktionen).getByRole("button", { name: "Jetzt abgleichen" })).toBeTruthy();
    expect(within(orte.zeitraum).getByDisplayValue("Dieses Jahr")).toBeTruthy();
    expect(within(orte.aktionen).queryByDisplayValue("Dieses Jahr")).toBeNull();
    cleanup();
    for (const el of Object.values(orte)) el.remove();
  });
});
