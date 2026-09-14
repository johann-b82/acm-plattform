/**
 * Organigramm in der Schale: Suche, Standortwahl und die Zählzeile stehen in
 * der rechten Leiste, der Baum bleibt auf der Seite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/organigramm", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/organigramm")>();
  return {
    ...echt,
    ladeFoto: async () => null,
    ladeOrganigramm: async () => [
      { id: 1, name: "Anna Chefin", position: "Leitung", department: "Lager", standort: "Bremen", vorgesetzter_id: null, hat_foto: false },
      { id: 2, name: "Bernd", position: "Fahrer", department: "Lager", standort: "Hamburg", vorgesetzter_id: 1, hat_foto: false },
    ],
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Organigramm } from "../organigramm";

let platz: HTMLElement;

afterEach(() => {
  cleanup();
  platz.remove();
});

describe("Organigramm in der rechten Leiste", () => {
  it("stellt Suche, Standort und Zählzeile in die Leiste", async () => {
    platz = document.createElement("div");
    document.body.appendChild(platz);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Organigramm />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByText("Bernd");
    expect(within(platz).getByText(/2 Personen/)).toBeTruthy();
    expect(within(platz).getByLabelText("Standort")).toBeTruthy();
    fireEvent.change(within(platz).getByLabelText("Person, Position oder Abteilung"), { target: { value: "Bernd" } });
    expect(screen.getByText("Bernd").closest("[data-treffer]")).toBeTruthy();
  });
});
