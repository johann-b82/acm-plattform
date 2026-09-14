/**
 * Kompetenzen in der Schale: Bereichswahl und Einlesen der Übersicht sowie
 * „Bearbeiten“ und der Weg zurück in der Matrix stehen in der rechten Leiste.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/kompetenzen", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/kompetenzen")>();
  const leer = async () => [];
  return {
    ...echt,
    kompetenzApi: {
      ...echt.kompetenzApi,
      matrizen: async () => [
        {
          id: "m1",
          bereich: "produktion",
          blatt: "Blatt A",
          titel: "Montage",
          stand: null,
          dateiname: "a.xlsx",
          importiert_am: "2026-09-01T00:00:00Z",
        },
      ],
      qualifikationen: leer,
      personen: leer,
      bewertungen: leer,
      stand: leer,
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Matrixliste } from "../matrixliste";
import { MatrixAnsicht } from "../[id]/matrix-ansicht";

let platz: HTMLElement;

function zeige(inhalt: ReactNode) {
  platz = document.createElement("div");
  document.body.appendChild(platz);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={platz}>{inhalt}</Werkzeugplatz.Provider>
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  platz.remove();
});

describe("Kompetenzen in der rechten Leiste", () => {
  it("stellt Bereichswahl und Einlesen der Übersicht in die Leiste", () => {
    zeige(<Matrixliste darfSchreiben />);
    expect(within(platz).getByLabelText("Bereich")).toBeTruthy();
    expect(within(platz).getByLabelText("Bereichsdatei einlesen")).toBeTruthy();
  });

  it("stellt „Bearbeiten“ und den Weg zur Übersicht der Matrix in die Leiste", async () => {
    zeige(<MatrixAnsicht id="m1" darfSchreiben />);
    await screen.findByRole("heading", { name: "Montage" });
    const knopf = within(platz).getByRole("button", { name: "Bearbeiten" });
    fireEvent.click(knopf);
    expect(within(platz).getByRole("button", { name: "Fertig" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(platz).getByRole("link", { name: "Zur Übersicht" })).toBeTruthy();
  });
});
