/**
 * Schulungen in der Schale: die Register, der Standortfilter des Stands, das
 * Anlegen samt Import und der Weg zurück zum Katalog stehen in der rechten
 * Leiste. Die Einlese-Vorschau und die Tabellen bleiben auf der Seite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/lib/schulungen", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/schulungen")>();
  const leer = async () => [];
  return {
    ...echt,
    schulungApi: {
      ...echt.schulungApi,
      katalog: async () => [
        {
          id: "s1",
          bereich: "betrieblich",
          name: "Erste Hilfe",
          turnus: null,
          turnus_monate: null,
          frist_tage: null,
          verantwortlicher: null,
          beschreibung: null,
          sortierung: 1,
          aktiv: true,
        },
      ],
      stand: leer,
      pflicht: leer,
      teilnahmen: leer,
      organigramm: leer,
      belegschaft: async () => [
        {
          schluessel: "e:1",
          employee_id: 1,
          extern_id: null,
          personalnummer: "1",
          name: "Anna",
          abteilung: "Lager",
          eintritt: null,
          herkunft: "personio",
          standort: "Bremen",
        },
      ],
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Schulungen } from "../schulungen";
import { RegisterBearbeiten } from "../register-bearbeiten";
import { SchulungAnsicht } from "../[id]/schulung-ansicht";

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

describe("Schulungen in der rechten Leiste", () => {
  it("stellt die Register in die Leiste und schaltet von dort um", async () => {
    zeige(<Schulungen darfSchreiben={false} />);
    const register = within(platz).getByRole("tablist");
    fireEvent.click(within(register).getByRole("tab", { name: "Stand der Mitarbeiter" }));
    expect(within(register).getByRole("tab", { name: "Stand der Mitarbeiter" }).getAttribute("aria-selected")).toBe("true");
    // Der Standortfilter des Stands gilt für alle vier Sichten — auch er steht in der Leiste.
    const chip = await within(platz).findByRole("button", { name: "Bremen" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("stellt Anlegen und Einlesen des Katalogs in die Leiste", () => {
    zeige(<RegisterBearbeiten darfSchreiben />);
    expect(within(platz).getByLabelText("Bereich")).toBeTruthy();
    const name = within(platz).getByLabelText("Neue Schulung");
    const anlegen = within(platz).getByRole("button", { name: "Anlegen" }) as HTMLButtonElement;
    expect(anlegen.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "Brandschutz" } });
    expect(anlegen.disabled).toBe(false);
    expect(within(platz).getByLabelText("Schulungsübersicht einlesen")).toBeTruthy();
  });

  it("stellt den Weg zurück zum Katalog in die Leiste", async () => {
    zeige(<SchulungAnsicht id="s1" darfSchreiben={false} />);
    await screen.findByRole("heading", { name: "Erste Hilfe" });
    expect(within(platz).getByRole("link", { name: "Zum Katalog" })).toBeTruthy();
  });
});
