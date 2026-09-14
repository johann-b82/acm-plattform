/**
 * Die Redaktion: Anlegen einer Ausgabe und die Wahl der bearbeiteten Ausgabe
 * stehen in der Schale in der rechten Leiste, das Formular der aktiven Ausgabe
 * bleibt auf der Seite. Wer eine andere Ausgabe wählt, sieht deren Titel —
 * nicht den der vorher gewählten.
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
import { Werkzeugplatz, type Kategorie } from "@/components/sidebar/werkzeugplatz";
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

let platz: Record<Kategorie, HTMLElement>;

beforeEach(() => {
  api.ausgaben.mockResolvedValue([ausgabe("a2", 2, "Sommer"), ausgabe("a1", 1, "Frühling")]);
  const neu = () => document.body.appendChild(document.createElement("div"));
  platz = { navigation: neu(), ansicht: neu(), filter: neu(), zeitraum: neu(), aktionen: neu() };
});

afterEach(() => {
  Object.values(platz).forEach((p) => p.remove());
});

describe("Redaktion", () => {
  it("zeigt nach dem Wechsel der Ausgabe deren Titel", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Redaktion darfKpi darfHr />
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const titel = await screen.findByLabelText("Titel der Ausgabe");
    await waitFor(() => expect(titel).toHaveValue("Sommer"));

    fireEvent.change(screen.getByLabelText("Ausgabe bearbeiten"), { target: { value: "a1" } });

    await waitFor(() => expect(screen.getByLabelText("Titel der Ausgabe")).toHaveValue("Frühling"));
  });
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

    const leiste = within(platz.aktionen);
    const jahr = leiste.getByLabelText("Jahr");
    expect(container).not.toContainElement(jahr);
    for (const titel of ["Jahr", "Quartal"]) {
      expect(leiste.getByText(titel).tagName).not.toBe("LABEL");
    }
    fireEvent.change(jahr, { target: { value: "2027" } });
    fireEvent.change(leiste.getByLabelText("Quartal"), { target: { value: "4" } });
    fireEvent.click(leiste.getByRole("button", { name: "Ausgabe anlegen" }));
    await waitFor(() => expect(api.ausgabeAnlegen).toHaveBeenCalledWith(2027, 4));

    // Die Ausgabewahl in der Leiste wechselt die bearbeitete Ausgabe; das
    // Titelfeld auf der Seite folgt ihr.
    const ansicht = within(platz.ansicht);
    expect(ansicht.getByText("Ausgabe bearbeiten")).toBeInTheDocument();
    const wahl = ansicht.getByRole("combobox", { name: "Ausgabe bearbeiten" });
    fireEvent.change(wahl, { target: { value: "a1" } });
    expect(wahl).toHaveValue("a1");
    await waitFor(() => expect(screen.getByLabelText("Titel der Ausgabe")).toHaveValue("Frühling"));
  });
});
