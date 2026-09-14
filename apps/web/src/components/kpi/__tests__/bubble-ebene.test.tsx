/**
 * Die Bubble-Ebene auf den Dashboard-Seiten (MAS-01): nur auf den Seiten der
 * Bereiche, zeigt die Bubbles dieser Seite mit Position. Neue Bubbles werden
 * hier nicht mehr gesetzt — einen Bubble-Knopf gibt es nicht.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Bubble } from "@/lib/kpi/bewertung";

const pfad = vi.hoisted(() => ({ jetzt: "/kpi/einkauf" }));
vi.mock("next/navigation", () => ({ usePathname: () => pfad.jetzt }));

const api = vi.hoisted(() => ({
  bubbles: vi.fn(),
  massnahmen: vi.fn(async () => []),
  bubbleGesehen: vi.fn(async () => undefined),
  bubbleLoeschen: vi.fn(async () => undefined),
}));
vi.mock("@/lib/kpi/bewertung", async (original) => ({
  ...(await original<typeof import("@/lib/kpi/bewertung")>()),
  bewertungApi: api,
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
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
    expect(api.bubbles).not.toHaveBeenCalled();
  });

  it("zeigt nur die Bubbles dieser Seite mit Position", async () => {
    zeige(false);
    expect(await screen.findByRole("button", { name: "Bubble 1: Text hier" })).toBeInTheDocument();
    expect(screen.queryByText("Text anderswo")).toBeNull();
    expect(screen.queryByText("Text ohne-position")).toBeNull();
  });

  it("hakt beim Ansehen durch Lesende nichts ab", async () => {
    zeige(false);
    fireEvent.click(await screen.findByRole("button", { name: "Bubble 1: Text hier" }));
    expect(api.bubbleGesehen).not.toHaveBeenCalled();
  });

  it("gibt auch Schreibenden keinen Bubble-Knopf — neue Bubbles werden hier nicht gesetzt", async () => {
    zeige(true);
    await screen.findByRole("button", { name: "Bubble 1: Text hier" });
    expect(screen.queryByRole("button", { name: "Bubble" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("hakt eine ungesehene Bubble ab, wenn Schreibende sie öffnen", async () => {
    zeige(true);
    fireEvent.click(await screen.findByRole("button", { name: "Bubble 1: Text hier" }));
    // Die Mutation läuft nach dem Klick an; TanStack reicht neben der Kennung
    // noch einen Kontext mit.
    await waitFor(() => expect(api.bubbleGesehen).toHaveBeenCalledWith("hier", expect.anything()));
  });
});
