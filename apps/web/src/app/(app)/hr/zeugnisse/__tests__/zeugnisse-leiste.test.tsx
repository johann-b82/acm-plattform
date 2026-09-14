/**
 * Zeugnisse in der Schale: Person, Art und „Anlegen“ der Liste sowie der Weg
 * zurück und das Löschen eines Zeugnisses stehen in der rechten Leiste.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("../textbausteine", () => ({ Textbausteine: () => null }));
vi.mock("@/lib/onboarding", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/onboarding")>();
  return {
    ...echt,
    onboardingApi: {
      ...echt.onboardingApi,
      eintritte: async () => [
        {
          employee_id: 7,
          extern_id: null,
          name: "Clara",
          abteilung: "Vertrieb",
          abteilung_gesetzt: true,
          position: null,
          eintritt: null,
          status: null,
          heruntergeladen_am: null,
        },
      ],
    },
  };
});
vi.mock("@/lib/zeugnisse", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/zeugnisse")>();
  return {
    ...echt,
    zeugnisApi: {
      ...echt.zeugnisApi,
      liste: async () => [],
      bewertungen: async () => [],
      unterschriften: () => new Promise(() => {}),
      eines: async () => ({
        id: "z1",
        employee_id: 7,
        extern_id: null,
        name: "Clara",
        geschlecht: null,
        geburtsdatum: null,
        personalnummer: null,
        abteilung: null,
        taetigkeit: null,
        eintritt: null,
        austritt: null,
        art: "qualifiziert",
        anlass: null,
        fuehrungskraft: false,
        ausstellungsdatum: null,
        taetigkeit_stichpunkte: null,
        besondere_kompetenzen: null,
        besondere_erfolge: null,
        schlussnote: null,
        abschnitte: null,
        status: "entwurf",
        erstellt_am: "2026-09-01T00:00:00Z",
      }),
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Zeugnisliste } from "../zeugnisliste";
import { ZeugnisAnsicht } from "../[id]/zeugnis-ansicht";

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

describe("Zeugnisse in der rechten Leiste", () => {
  it("stellt Person, Art und „Anlegen“ in die Leiste", async () => {
    zeige(<Zeugnisliste />);
    const person = within(platz).getByLabelText("Person");
    expect(within(platz).getByLabelText("Art")).toBeTruthy();
    const anlegen = within(platz).getByRole("button", { name: "Anlegen" }) as HTMLButtonElement;
    expect(anlegen.disabled).toBe(true);
    await within(platz).findByRole("option", { name: /Clara/ });
    fireEvent.change(person, { target: { value: "7" } });
    expect(anlegen.disabled).toBe(false);
  });

  it("stellt den Weg zur Übersicht und das Löschen in die Leiste", async () => {
    zeige(<ZeugnisAnsicht id="z1" />);
    await screen.findByRole("heading", { name: "Clara" });
    expect(within(platz).getByRole("link", { name: "Zur Übersicht" })).toBeTruthy();
    expect(within(platz).getByRole("button", { name: /löschen/i })).toBeTruthy();
  });
});
