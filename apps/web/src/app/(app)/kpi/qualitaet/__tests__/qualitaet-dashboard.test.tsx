/**
 * Die Qualitätsseite im DOM: der Filter Auditart steht in derselben Zeile wie
 * der Umschalter Audits/Reklamationen/Qualitätsprüfung und nur bei Audits.
 */
import { describe, expect, it, vi } from "vitest";
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
import { QualitaetDashboard } from "../qualitaet-dashboard";

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <QualitaetDashboard darfUploads={false} />
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

  it("zeigt die Auditart nur bei Audits", () => {
    zeige();
    const umschalter = screen.getByRole("radiogroup", { name: "Ansicht" });
    fireEvent.click(within(umschalter).getByRole("radio", { name: "Reklamationen" }));
    expect(screen.queryByRole("button", { name: "Behörde" })).not.toBeInTheDocument();
  });
});
