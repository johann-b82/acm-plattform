/**
 * Die Zeichnungsliste stellt Hochladen und den Kundenfilter in die rechte
 * Leiste; der Filter wirkt weiter auf die Tabelle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { zeichnungen } = vi.hoisted(() => ({ zeichnungen: vi.fn() }));

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/fair" }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/fair", async (original) => {
  const echt = await original<typeof import("@/lib/fair")>();
  return { ...echt, fairApi: { ...echt.fairApi, zeichnungen } };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import type { Zeichnung } from "@/lib/fair";
import { Zeichnungsliste } from "./zeichnungsliste";

function zeichnung(id: string, name: string, kunde: string | null): Zeichnung {
  return {
    id,
    name,
    teilenummer: null,
    kunde,
    artikelnummer: null,
    pfad: `${id}.pdf`,
    art: "pdf",
    mime: null,
    seiten: 1,
    drehung: 0,
    erstellt_am: "2026-09-01T00:00:00Z",
  } as Zeichnung;
}

let platz: HTMLElement;

beforeEach(() => {
  zeichnungen.mockResolvedValue([
    zeichnung("a", "Halter", "Pilatus"),
    zeichnung("b", "Winkel", "Airbus"),
  ]);
  platz = document.createElement("div");
  document.body.appendChild(platz);
});

afterEach(() => {
  platz.remove();
});

describe("Zeichnungsliste in der Schale", () => {
  it("stellt Hochladen und Kundenfilter in die Leiste", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Zeichnungsliste darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByText("Halter");
    const leiste = within(platz);
    const name = leiste.getByLabelText("Bezeichnung (leer = Dateiname)");
    expect(container).not.toContainElement(name);
    expect(leiste.getByLabelText("Zeichnung wählen")).toBeInTheDocument();

    const filter = leiste.getByRole("combobox", { name: "Nach Kunde filtern" });
    fireEvent.change(filter, { target: { value: "Airbus" } });
    expect(screen.queryByText("Halter")).not.toBeInTheDocument();
    expect(screen.getByText("Winkel")).toBeInTheDocument();
  });
});
