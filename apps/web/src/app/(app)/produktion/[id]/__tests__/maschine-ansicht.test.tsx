/**
 * Eine Maschine in der Schale: der Weg zurück zur Übersicht und das Löschen
 * der ganzen Maschine stehen in der rechten Leiste.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Maschine } from "@/lib/wartung";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("@/lib/compute", () => ({ computeFetch: vi.fn() }));

const MASCHINE: Maschine = {
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
};

vi.mock("@/lib/wartung", async (original) => {
  const echt = await original<typeof import("@/lib/wartung")>();
  return {
    ...echt,
    wartungApi: {
      ...echt.wartungApi,
      maschine: vi.fn(async () => MASCHINE),
      aufgaben: vi.fn(async () => []),
      dateien: vi.fn(async () => []),
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { MaschineAnsicht } from "../maschine-ansicht";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MaschineAnsicht", () => {
  it("stellt „Zur Übersicht“ und das Löschen der Maschine in die rechte Leiste", async () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <MaschineAnsicht id="m1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    expect(await within(platz).findByRole("button", { name: "Presse 1 löschen" })).toBeInTheDocument();
    expect(within(platz).getByRole("link", { name: "Zur Übersicht" })).toHaveAttribute("href", "/produktion");
  });
});
