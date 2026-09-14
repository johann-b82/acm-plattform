/**
 * Die Lieferungsliste stellt Einlesen und Durchsehen des Eingangs in die
 * rechte Leiste; ohne Schale bleiben sie an Ort und Stelle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { liste, lauf } = vi.hoisted(() => ({ liste: vi.fn(), lauf: vi.fn() }));

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/atr" }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/atr", async (original) => {
  const echt = await original<typeof import("@/lib/atr")>();
  return {
    ...echt,
    lieferungApi: { ...echt.lieferungApi, liste },
    scanApi: { ...echt.scanApi, lauf },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Lieferungsliste } from "./lieferungsliste";

let platz: HTMLElement;

beforeEach(() => {
  liste.mockResolvedValue([]);
  lauf.mockResolvedValue({ gelesen: 0, angelegt: 0, hinweise: [] });
  platz = document.createElement("div");
  document.body.appendChild(platz);
});

afterEach(() => {
  platz.remove();
});

function zeige() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={platz}>
          <Lieferungsliste darfSchreiben />
        </Werkzeugplatz.Provider>
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Lieferungsliste in der Schale", () => {
  it("stellt Einlesen und Eingang durchsehen in die Leiste", async () => {
    const { container } = zeige();
    const leiste = within(platz);
    expect(leiste.getByLabelText("Lieferschein einlesen")).toBeInTheDocument();
    const knopf = leiste.getByRole("button", { name: "Eingang durchsehen" });
    expect(container).not.toContainElement(knopf);

    fireEvent.click(knopf);
    await waitFor(() => expect(lauf).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Eingang durchsehen" })).toBeInTheDocument();
  });
});
