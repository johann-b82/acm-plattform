/**
 * Die Bubble-Ebene auf den Dashboard-Seiten (MAS-01): nur auf den Seiten der
 * Bereiche, Knopf nur für Schreibende, ein aufgezogenes Rechteck wird mit
 * Bereich und Position gespeichert.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Bubble } from "@/lib/kpi/bewertung";

const pfad = vi.hoisted(() => ({ jetzt: "/kpi/einkauf" }));
vi.mock("next/navigation", () => ({ usePathname: () => pfad.jetzt }));

const api = vi.hoisted(() => ({
  bubbles: vi.fn(),
  massnahmen: vi.fn(async () => []),
  bubbleAnlegen: vi.fn(async () => undefined),
  bubbleGesehen: vi.fn(async () => undefined),
  bubbleLoeschen: vi.fn(async () => undefined),
}));
vi.mock("@/lib/kpi/bewertung", async (original) => ({
  ...(await original<typeof import("@/lib/kpi/bewertung")>()),
  bewertungApi: api,
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { BubbleEbene } from "../bubble-ebene";

function bubble(id: string, bereich: string, felder: Partial<Bubble> = {}): Bubble {
  return {
    id, schluessel: null, bereich, nummer: 1, text: `Text ${id}`, ampel: null,
    pos_x: 0.1, pos_y: 0.1, breite: 0.2, hoehe: 0.2, verfasser_email: null,
    gesehen_am: null, erstellt_am: "2026-09-10T10:00:00Z", ...felder,
  };
}

function zeige(darfSchreiben: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <BubbleEbene darfLesen darfSchreiben={darfSchreiben}>
          <p>Dashboard</p>
        </BubbleEbene>
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pfad.jetzt = "/kpi/einkauf";
  api.bubbles.mockResolvedValue([
    bubble("hier", "einkauf"),
    bubble("ohne-position", "einkauf", { pos_x: null, pos_y: null, breite: null, hoehe: null }),
    bubble("anderswo", "vertrieb"),
  ]);
});

describe("Bubble-Ebene", () => {
  it("reicht auf Seiten ohne Bereich nur den Inhalt durch", () => {
    pfad.jetzt = "/kpi/bewertung";
    zeige(true);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bubble" })).toBeNull();
    expect(api.bubbles).not.toHaveBeenCalled();
  });

  it("zeigt nur die Bubbles dieser Seite mit Position", async () => {
    zeige(false);
    expect(await screen.findByRole("button", { name: "Bubble 1: Text hier" })).toBeInTheDocument();
    expect(screen.queryByText("Text anderswo")).toBeNull();
    expect(screen.queryByText("Text ohne-position")).toBeNull();
  });

  it("gibt Lesenden keinen Bubble-Knopf und hakt beim Ansehen nichts ab", async () => {
    zeige(false);
    fireEvent.click(await screen.findByRole("button", { name: "Bubble 1: Text hier" }));
    expect(screen.queryByRole("button", { name: "Bubble" })).toBeNull();
    expect(api.bubbleGesehen).not.toHaveBeenCalled();
  });

  it("stellt den Bubble-Knopf in der Schale in die rechte Leiste, ohne zu schweben", async () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <BubbleEbene darfLesen darfSchreiben>
              <p>Dashboard</p>
            </BubbleEbene>
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const knopf = within(platz).getByRole("button", { name: "Bubble" });
    expect(knopf.className).not.toContain("fixed");
    fireEvent.click(knopf);
    expect(knopf).toHaveAttribute("aria-pressed", "true");
    platz.remove();
  });

  it("speichert ein aufgezogenes Rechteck mit Bereich, Text und Ampel", async () => {
    const { container } = zeige(true);
    await screen.findByRole("button", { name: "Bubble 1: Text hier" });
    fireEvent.click(screen.getByRole("button", { name: "Bubble" }));

    const flaeche = container.querySelector(".relative.min-w-0") as HTMLElement;
    flaeche.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const zeichnung = flaeche.lastElementChild as HTMLElement;
    fireEvent.mouseDown(zeichnung, { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(zeichnung, { clientX: 400, clientY: 150 });
    fireEvent.mouseUp(zeichnung, { clientX: 400, clientY: 150 });

    fireEvent.change(screen.getByRole("textbox", { name: "Was stimmt hier nicht?" }), {
      target: { value: "Knick" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "keine Ampel" }), { target: { value: "rot" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.bubbleAnlegen).toHaveBeenCalledWith({
        bereich: "einkauf",
        text: "Knick",
        ampel: "rot",
        rechteck: { x: 0.1, y: 0.1, w: expect.closeTo(0.3), h: expect.closeTo(0.2) },
      }),
    );
  });
});
