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
import { Werkzeugplatz, type Kategorie } from "@/components/sidebar/werkzeugplatz";
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

let platz: Record<Kategorie, HTMLElement>;

beforeEach(() => {
  api.ausgaben.mockResolvedValue([ausgabe("a2", 2), ausgabe("a1", 1)]);
  const neu = () => document.body.appendChild(document.createElement("div"));
  platz = { navigation: neu(), ansicht: neu(), filter: neu(), zeitraum: neu(), aktionen: neu() };
});

afterEach(() => {
  Object.values(platz).forEach((p) => p.remove());
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
    const leiste = within(platz.aktionen);
    const pdf = leiste.getByRole("button", { name: "Als PDF" });
    expect(container).not.toContainElement(pdf);
    expect(leiste.getByRole("link", { name: "Redaktion" })).toHaveAttribute(
      "href",
      "/newsletter/redaktion",
    );

    const ansicht = within(platz.ansicht);
    expect(ansicht.getByText("Ausgabe")).toBeInTheDocument();
    fireEvent.change(ansicht.getByRole("combobox", { name: "Ausgabe" }), {
      target: { value: "a1" },
    });
    expect(await screen.findByText("Ansicht a1")).toBeInTheDocument();
  });
});
