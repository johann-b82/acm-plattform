/**
 * Der Leser stellt Ausgabewahl, PDF-Export und den Weg zur Redaktion in die
 * rechte Leiste; Überschrift und Ausgabe bleiben auf der Seite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  ausgaben: vi.fn(),
  kapitel: vi.fn(async () => []),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/newsletter", () => ({
  newsletterApi: api,
  newsletterKeys: {
    ausgaben: () => ["newsletter", "ausgaben"],
    kapitel: (id: string) => ["newsletter", "kapitel", id],
  },
}));
vi.mock("@/lib/newsletter/pdf", () => ({ alsPdf: vi.fn() }));
vi.mock("./bild-urls", () => ({ useBildUrls: () => ({}) }));
vi.mock("./ausgabe-ansicht", () => ({
  AusgabeAnsicht: ({ ausgabe }: { ausgabe: { id: string } }) => <p>Ansicht {ausgabe.id}</p>,
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { NewsletterLeser } from "./leser";

function ausgabe(id: string, quartal: number) {
  return {
    id,
    jahr: 2026,
    quartal,
    titel: null,
    status: "veroeffentlicht",
    titelbild: null,
    rueckseite: null,
    geaendert_am: "2026-09-01T00:00:00Z",
  };
}

let platz: HTMLElement;

beforeEach(() => {
  api.ausgaben.mockResolvedValue([ausgabe("a2", 2), ausgabe("a1", 1)]);
  platz = document.createElement("div");
  document.body.appendChild(platz);
});

afterEach(() => {
  platz.remove();
});

describe("Newsletter-Leser in der Schale", () => {
  it("stellt Ausgabe, PDF und Redaktion in die Leiste", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <NewsletterLeser darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Ansicht a2")).toBeInTheDocument();
    const leiste = within(platz);
    const pdf = leiste.getByRole("button", { name: "Als PDF" });
    expect(container).not.toContainElement(pdf);
    expect(leiste.getByRole("link", { name: "Redaktion" })).toHaveAttribute(
      "href",
      "/newsletter/redaktion",
    );

    fireEvent.change(leiste.getByRole("combobox", { name: "Ausgabe" }), {
      target: { value: "a1" },
    });
    expect(await screen.findByText("Ansicht a1")).toBeInTheDocument();
  });
});
