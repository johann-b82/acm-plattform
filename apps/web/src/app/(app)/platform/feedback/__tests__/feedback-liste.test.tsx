/**
 * Meldungen (MEL-01): Tabelle und Kanban zeigen dieselbe Menge mit denselben
 * Aktionen; gesehen ist ein eigener Zustand neben dem Status.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Feedback } from "@/lib/feedback";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));

const api = vi.hoisted(() => ({
  liste: vi.fn(),
  status: vi.fn(async () => undefined),
  gesehen: vi.fn(async () => undefined),
  loeschen: vi.fn(async () => undefined),
  bildUrl: vi.fn(async () => "blob:bild"),
}));
vi.mock("@/lib/feedback", async (original) => ({
  ...(await original<typeof import("@/lib/feedback")>()),
  feedbackApi: api,
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { FeedbackListe } from "../feedback-liste";

function meldung(id: string, felder: Partial<Feedback>): Feedback {
  return {
    id,
    seite: `/seite/${id}`,
    beschreibung: `Beschreibung ${id}`,
    bild_pfad: null,
    browser: null,
    ansicht: null,
    status: "neu",
    gesehen_am: "2026-09-01T10:00:00Z",
    erstellt_am: "2026-09-01T10:00:00Z",
    melder_email: `${id}@example.com`,
    ...felder,
  };
}

const MELDUNGEN = [
  meldung("a", { gesehen_am: null, bild_pfad: "u/a.jpg" }),
  meldung("b", {}),
  meldung("c", { status: "erledigt" }),
];

function zeige() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <FeedbackListe />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.liste.mockResolvedValue(MELDUNGEN);
});

describe("Meldungen", () => {
  it("zeigt die Tabelle mit den Spalten der Referenz", async () => {
    zeige();
    // Erst die Daten: vorher steht in der Tabelle nur die Ladezeile.
    await screen.findByText("Beschreibung a");
    const tabelle = screen.getByRole("table");
    for (const titel of ["Datum", "Von", "Seite", "Beschreibung", "Screenshot", "Status", "Aktionen"]) {
      expect(within(tabelle).getByText(titel)).toBeInTheDocument();
    }
    expect(within(tabelle).getAllByRole("row")).toHaveLength(4);
    expect(within(tabelle).getByRole("button", { name: "Öffnen" })).toBeInTheDocument();
  });

  it("markiert beim bloßen Öffnen nichts als gesehen", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    expect(screen.getAllByRole("button", { name: /ungesehen/ })).toHaveLength(1);
    expect(api.gesehen).not.toHaveBeenCalled();
  });

  it("zeigt im Kanban dieselben Meldungen in den Spalten offen und erledigt", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    fireEvent.click(screen.getByRole("radio", { name: "Kanban" }));
    const offen = screen.getByRole("region", { name: "offen" });
    const erledigt = screen.getByRole("region", { name: "erledigt" });
    expect(within(offen).getByText("Beschreibung a")).toBeInTheDocument();
    expect(within(offen).getByText("Beschreibung b")).toBeInTheDocument();
    expect(within(erledigt).getByText("Beschreibung c")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /ungesehen/ })).toBeNull();
    // Dieselben Aktionen wie in der Tabelle.
    expect(within(offen).getAllByRole("button", { name: "Als erledigt markieren" })).toHaveLength(2);
    expect(within(erledigt).getByRole("button", { name: "Wieder öffnen" })).toBeInTheDocument();
  });

  it("erledigen ändert den Status und hakt die ungesehene Meldung ab", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    fireEvent.click(screen.getAllByRole("button", { name: "Als erledigt markieren" })[0]);
    await waitFor(() => expect(api.status).toHaveBeenCalledWith("a", "erledigt"));
    expect(api.gesehen).toHaveBeenCalledWith(["a"]);
  });

  it("wieder öffnen setzt den Status auf offen und lässt gesehen unberührt", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    fireEvent.click(screen.getByRole("button", { name: "Wieder öffnen" }));
    await waitFor(() => expect(api.status).toHaveBeenCalledWith("c", "neu"));
    expect(api.gesehen).not.toHaveBeenCalled();
  });

  it("der Punkt hakt nur ab, der Status bleibt", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    fireEvent.click(screen.getByRole("button", { name: /ungesehen/ }));
    await waitFor(() => expect(api.gesehen).toHaveBeenCalledWith(["a"]));
    expect(api.status).not.toHaveBeenCalled();
  });
});
