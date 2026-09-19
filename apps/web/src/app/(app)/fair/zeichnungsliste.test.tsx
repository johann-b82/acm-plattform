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
import { Werkzeugplatz, type Kategorie } from "@/components/sidebar/werkzeugplatz";
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

let platz: Record<Kategorie, HTMLElement>;

beforeEach(() => {
  zeichnungen.mockResolvedValue([
    zeichnung("a", "Halter", "Pilatus"),
    zeichnung("b", "Winkel", "Airbus"),
  ]);
  const neu = () => document.body.appendChild(document.createElement("div"));
  platz = { navigation: neu(), ansicht: neu(), filter: neu(), zeitraum: neu(), aktionen: neu() };
});

afterEach(() => {
  Object.values(platz).forEach((p) => p.remove());
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
    const leiste = within(platz.aktionen);
    const name = leiste.getByLabelText("Bezeichnung (leer = Dateiname)");
    expect(leiste.getByText("Bezeichnung (leer = Dateiname)").tagName).not.toBe("LABEL");
    expect(container).not.toContainElement(name);
    expect(leiste.getByLabelText("Zeichnung wählen")).toBeInTheDocument();

    const filterPlatz = within(platz.filter);
    expect(filterPlatz.getByText("Kunde")).toBeInTheDocument();
    const filter = filterPlatz.getByRole("combobox", { name: "Nach Kunde filtern" });
    fireEvent.change(filter, { target: { value: "Airbus" } });
    expect(screen.queryByText("Halter")).not.toBeInTheDocument();
    expect(screen.getByText("Winkel")).toBeInTheDocument();
  });

  it("gruppiert die Zeichnungen nach Kunde mit Überschrift", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Zeichnungsliste darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByText("Halter");
    // Jede Kundengruppe ist ein eigener Abschnitt mit dem Kundennamen als Titel.
    const airbus = screen.getByRole("region", { name: "Airbus" });
    const pilatus = screen.getByRole("region", { name: "Pilatus" });
    expect(within(airbus).getByText("Winkel")).toBeInTheDocument();
    expect(within(pilatus).getByText("Halter")).toBeInTheDocument();
    // Airbus steht vor Pilatus (alphabetisch).
    expect(airbus.compareDocumentPosition(pilatus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
