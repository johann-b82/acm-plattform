/**
 * Der Editor stellt Rückweg und Zeichenwerkzeuge (Seite, Drehen, Zoom,
 * Einpassen, Bubblegröße) in die rechte Leiste. PDF-Raster, OCR und die
 * Prüfliste sind hier ersetzt — es geht nur darum, wo die Werkzeuge stehen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

const api = vi.hoisted(() => ({
  zeichnung: vi.fn(),
  dateiUrl: vi.fn(async () => "blob:zeichnung"),
  ballons: vi.fn(async () => []),
  zeichnungAendern: vi.fn(async () => undefined),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/fair", () => ({
  fairApi: api,
  fairKeys: {
    zeichnungen: () => ["fair", "zeichnungen"],
    zeichnung: (id: string) => ["fair", "zeichnung", id],
    datei: (pfad: string) => ["fair", "datei", pfad],
    ballons: (id: string) => ["fair", "ballons", id],
  },
}));
vi.mock("@/lib/fair/ocr", () => ({ beendeOcr: vi.fn(), liesFeld: vi.fn() }));
vi.mock("../raster", () => ({ feldAlsLeinwand: vi.fn(), seitenAlsBilder: vi.fn() }));
vi.mock("../ballonliste", () => ({ Ballonliste: () => null }));
vi.mock("../zeichenflaeche", () => ({
  Zeichenflaeche: ({ onSeiten }: { onSeiten: (n: number) => void }) => {
    useEffect(() => onSeiten(2), [onSeiten]);
    return null;
  },
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz, type Kategorie } from "@/components/sidebar/werkzeugplatz";
import { Editor } from "../editor";

let platz: Record<Kategorie, HTMLElement>;

beforeEach(() => {
  api.zeichnung.mockResolvedValue({
    id: "z1",
    name: "Halter",
    teilenummer: null,
    kunde: null,
    artikelnummer: null,
    pfad: "z1.pdf",
    art: "pdf",
    mime: null,
    seiten: 2,
    drehung: 0,
    erstellt_am: "2026-09-01T00:00:00Z",
  });
  const neu = () => document.body.appendChild(document.createElement("div"));
  platz = { navigation: neu(), ansicht: neu(), filter: neu(), zeitraum: neu(), aktionen: neu() };
});

afterEach(() => {
  Object.values(platz).forEach((p) => p.remove());
});

describe("Editor in der Schale", () => {
  it("stellt Rückweg und Zeichenwerkzeuge in die Leiste", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Editor id="z1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Halter" });
    const leiste = within(platz.ansicht);

    expect(within(platz.navigation).getByRole("link", { name: "Zeichnungen" })).toHaveAttribute(
      "href",
      "/fair",
    );
    for (const titel of ["Seite", "Darstellung", "Bubble-Größe"]) {
      expect(await leiste.findByText(titel)).toBeInTheDocument();
    }
    for (const name of [
      "Ansicht drehen",
      "Verkleinern",
      "Vergrößern",
      "Einpassen",
      "Bubbles kleiner",
      "Bubbles größer",
    ]) {
      const knopf = leiste.getByRole("button", { name });
      expect(container).not.toContainElement(knopf);
    }

    const seite = await waitFor(() => leiste.getByRole("combobox", { name: "Seite" }));
    fireEvent.change(seite, { target: { value: "2" } });
    expect(seite).toHaveValue("2");

    fireEvent.click(leiste.getByRole("button", { name: "Ansicht drehen" }));
    await waitFor(() => expect(api.zeichnungAendern).toHaveBeenCalledWith("z1", { drehung: 90 }));
  });
});
