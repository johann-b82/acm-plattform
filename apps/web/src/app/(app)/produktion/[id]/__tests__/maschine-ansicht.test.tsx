/**
 * Eine Maschine in der Schale: der Weg zurück zur Übersicht und das Löschen
 * der ganzen Maschine stehen in der rechten Leiste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Maschine } from "@/lib/wartung";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("@/lib/compute", () => ({ computeFetch: vi.fn() }));
const live = vi.hoisted(() => ({ useLiveTabellen: vi.fn() }));
vi.mock("@/components/realtime/live", () => live);
vi.mock("@/components/realtime/anwesenheit", () => ({
  Anwesenheit: ({ tabelle, kennung }: { tabelle: string; kennung: string }) => (
    <p data-testid="anwesenheit">{`${tabelle}:${kennung}`}</p>
  ),
}));

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
  version: 4,
};

const wartung = vi.hoisted(() => ({
  maschine: vi.fn(),
  aufgaben: vi.fn(),
  aendern: vi.fn(async () => undefined),
  aufgabeAendern: vi.fn(async () => undefined),
}));
vi.mock("@/lib/wartung", async (original) => {
  const echt = await original<typeof import("@/lib/wartung")>();
  return {
    ...echt,
    wartungApi: {
      ...echt.wartungApi,
      ...wartung,
      dateien: vi.fn(async () => []),
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { MaschineAnsicht } from "../maschine-ansicht";

beforeEach(() => {
  wartung.maschine.mockResolvedValue(MASCHINE);
  wartung.aufgaben.mockResolvedValue([]);
});

afterEach(() => {
  document.body.innerHTML = "";
});

function zeigeMitClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SprachAnbieter sprache="de">
        <MaschineAnsicht id="m1" darfSchreiben />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
  return client;
}

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

  it("ordnet „Zur Übersicht“ der Navigation und das Löschen den Aktionen zu", async () => {
    const plaetze = {
      navigation: document.createElement("div"),
      ansicht: document.createElement("div"),
      filter: document.createElement("div"),
      zeitraum: document.createElement("div"),
      aktionen: document.createElement("div"),
    };
    Object.values(plaetze).forEach((p) => document.body.appendChild(p));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={plaetze}>
            <MaschineAnsicht id="m1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const { navigation, aktionen } = plaetze;
    expect(await within(aktionen).findByRole("button", { name: "Presse 1 löschen" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Zur Übersicht" })).toHaveAttribute("href", "/produktion");
    expect(within(aktionen).queryByRole("link")).toBeNull();
  });

  it("hält Maschine und Aufgaben live und zeigt, wer die Maschine noch offen hat", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <MaschineAnsicht id="m1" darfSchreiben />
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("anwesenheit")).toHaveTextContent("maschinen:m1");
    expect(live.useLiveTabellen).toHaveBeenCalledWith(["maschinen", "wartungsaufgaben"]);
  });

  it("speichert die Stammdaten mit der Version, auf der der Entwurf beruht — nicht mit der nachgeladenen", async () => {
    wartung.aendern.mockClear();
    const client = zeigeMitClient();
    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    // Jemand anders speichert die Maschine; die Seite lädt live nach.
    wartung.maschine.mockResolvedValue({ ...MASCHINE, name: "Presse 1 (Zoe)", version: 5 });
    await client.invalidateQueries();
    await screen.findByRole("heading", { name: "Presse 1 (Zoe)" });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(wartung.aendern).toHaveBeenCalled());
    expect(wartung.aendern).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", version: 4 }),
      expect.anything(),
    );
  });

  it("speichert den Titel einer Aufgabe mit der Version beim Betreten des Feldes", async () => {
    const AUFGABE = {
      id: "w1",
      maschine_id: "m1",
      titel: "Öl",
      anleitung: "",
      intervall: "monatlich",
      wochen: null,
      erstellt_am: "2026-09-01T00:00:00Z",
      version: 1,
    };
    wartung.aufgaben.mockResolvedValue([AUFGABE]);
    wartung.aufgabeAendern.mockClear();
    const client = zeigeMitClient();
    const feld = await screen.findByDisplayValue("Öl");
    fireEvent.focus(feld);
    // Während jemand tippt, ändert ein anderer die Aufgabe; die Liste lädt nach.
    const vorher = wartung.aufgaben.mock.calls.length;
    wartung.aufgaben.mockResolvedValue([{ ...AUFGABE, anleitung: "neu", version: 2 }]);
    await client.invalidateQueries();
    await waitFor(() => expect(wartung.aufgaben.mock.calls.length).toBeGreaterThan(vorher));
    fireEvent.change(feld, { target: { value: "Filter" } });
    fireEvent.blur(feld);
    await waitFor(() => expect(wartung.aufgabeAendern).toHaveBeenCalled());
    expect(wartung.aufgabeAendern).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", version: 1 }),
      { titel: "Filter" },
    );
  });
});
