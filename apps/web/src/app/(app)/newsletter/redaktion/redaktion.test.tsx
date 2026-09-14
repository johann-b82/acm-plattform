/**
 * Die Redaktion stellt Anlegen einer Ausgabe und die Wahl der bearbeiteten
 * Ausgabe in die rechte Leiste. Das Formular der aktiven Ausgabe bleibt auf
 * der Seite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  ausgaben: vi.fn(),
  kapitel: vi.fn(async () => []),
  ausgabeAnlegen: vi.fn(async () => undefined),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/newsletter/redaktion" }));
vi.mock("@/lib/newsletter", () => ({
  newsletterApi: api,
  newsletterKeys: {
    ausgaben: () => ["newsletter", "ausgaben"],
    kapitel: (id: string) => ["newsletter", "kapitel", id],
  },
  quartalVon: () => 3,
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Redaktion } from "./redaktion";

function ausgabe(id: string, quartal: number, titel: string) {
  return {
    id,
    jahr: 2026,
    quartal,
    titel,
    status: "entwurf",
    titelbild: null,
    rueckseite: null,
    geaendert_am: "2026-09-01T00:00:00Z",
  };
}

let platz: HTMLElement;

beforeEach(() => {
  api.ausgaben.mockResolvedValue([ausgabe("a2", 2, "Sommer"), ausgabe("a1", 1, "Frühling")]);
  platz = document.createElement("div");
  document.body.appendChild(platz);
});

afterEach(() => {
  platz.remove();
});

describe("Redaktion in der Schale", () => {
  it("stellt Jahr, Quartal, Anlegen und Ausgabewahl in die Leiste", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Redaktion darfKpi darfHr />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const titel = await screen.findByLabelText("Titel der Ausgabe");
    expect(container).toContainElement(titel);
    expect(titel).toHaveValue("Sommer");

    const leiste = within(platz);
    const jahr = leiste.getByLabelText("Jahr");
    expect(container).not.toContainElement(jahr);
    fireEvent.change(jahr, { target: { value: "2027" } });
    fireEvent.change(leiste.getByLabelText("Quartal"), { target: { value: "4" } });
    fireEvent.click(leiste.getByRole("button", { name: "Ausgabe anlegen" }));
    await waitFor(() => expect(api.ausgabeAnlegen).toHaveBeenCalledWith(2027, 4));

    // Der Platzhalter folgt der gewählten Ausgabe; der Titel selbst ist ein
    // ungesteuertes Feld und bleibt beim Wechsel stehen (vorhandenes Verhalten).
    const vorher = screen.getByLabelText("Titel der Ausgabe").getAttribute("placeholder");
    const wahl = leiste.getByRole("combobox", { name: "Ausgabe bearbeiten" });
    fireEvent.change(wahl, { target: { value: "a1" } });
    expect(wahl).toHaveValue("a1");
    await waitFor(() =>
      expect(screen.getByLabelText("Titel der Ausgabe").getAttribute("placeholder")).not.toBe(vorher),
    );
  });
});
