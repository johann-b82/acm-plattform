/**
 * App Feedback zur aktuellen Seite in der rechten Leiste: die nicht erledigten
 * Meldungen dieses Pfads, jede mit Verweis auf die Liste.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ usePathname: () => "/kpi/vertrieb" }));
const live = vi.hoisted(() => ({ useLiveTabellen: vi.fn() }));
vi.mock("@/components/realtime/live", () => live);

const api = vi.hoisted(() => ({
  zurSeite: vi.fn(),
  konten: vi.fn(async () => [{ id: "u1", email: "zoe@example.com" }]),
}));
vi.mock("@/lib/feedback", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/feedback")>();
  return { ...echt, feedbackApi: api };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { SeitenFeedback } from "../seiten-feedback";

function meldung(id: string, status: "neu" | "in_bearbeitung", zugewiesen: string | null) {
  return {
    id,
    seite: "/kpi/vertrieb",
    beschreibung: `Beschreibung ${id}`,
    bild_pfad: null,
    browser: null,
    ansicht: null,
    status,
    gesehen_am: null,
    erstellt_am: "2026-09-01T08:00:00Z",
    melder_email: null,
    zugewiesen,
    version: 1,
  };
}

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <SeitenFeedback />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("SeitenFeedback", () => {
  beforeEach(() => api.zurSeite.mockReset());

  it("fragt nach dem Pfad der Seite und zeigt Beschreibung, Status und Zuständige", async () => {
    api.zurSeite.mockResolvedValue([meldung("a", "neu", null), meldung("b", "in_bearbeitung", "u1")]);
    zeige();
    expect(await screen.findByText("Beschreibung a")).toBeInTheDocument();
    expect(api.zurSeite).toHaveBeenCalledWith("/kpi/vertrieb");
    expect(screen.getByRole("heading", { name: "App Feedback zu dieser Seite" })).toBeInTheDocument();
    expect(screen.getByText("offen")).toBeInTheDocument();
    expect(screen.getByText("In Bearbeitung")).toBeInTheDocument();
    expect(await screen.findByText("zoe@example.com")).toBeInTheDocument();
    expect(screen.getByText("Nicht zugewiesen")).toBeInTheDocument();
    for (const verweis of screen.getAllByRole("link")) {
      expect(verweis).toHaveAttribute("href", "/platform/feedback");
    }
  });

  it("bleibt unsichtbar, solange zur Seite nichts offen ist", async () => {
    api.zurSeite.mockResolvedValue([]);
    const { container } = zeige();
    await vi.waitFor(() => expect(api.zurSeite).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("hält App Feedback live — eine neue Meldung zur Seite erscheint ohne Neuladen", async () => {
    api.zurSeite.mockResolvedValue([]);
    zeige();
    await vi.waitFor(() => expect(api.zurSeite).toHaveBeenCalled());
    expect(live.useLiveTabellen).toHaveBeenCalledWith(["feedback"]);
  });
});
