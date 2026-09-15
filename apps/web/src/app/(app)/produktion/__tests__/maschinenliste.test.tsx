/**
 * Die Maschinenliste bleibt live (ADR-0006): legt jemand eine Maschine an oder
 * ändert sie, sehen es alle, die die Liste offen haben.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("@/lib/wartung", async (original) => {
  const echt = await original<typeof import("@/lib/wartung")>();
  return {
    ...echt,
    wartungApi: {
      ...echt.wartungApi,
      maschinen: vi.fn(async () => [
        {
          id: "m1",
          name: "Presse 1",
          inventarnummer: null,
          standort: null,
          hersteller: null,
          modell: null,
          verantwortlich: null,
          status: "aktiv",
          notizen: "",
          geaendert_am: "2026-09-10T10:00:00Z",
          version: 1,
        },
      ]),
    },
  };
});
const live = vi.hoisted(() => ({ useLiveTabellen: vi.fn() }));
vi.mock("@/components/realtime/live", () => live);

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Maschinenliste } from "../maschinenliste";

describe("Maschinenliste", () => {
  it("hält die Maschinen live", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Maschinenliste darfSchreiben />
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Presse 1")).toBeInTheDocument();
    expect(live.useLiveTabellen).toHaveBeenCalledWith(["maschinen"]);
  });
});
