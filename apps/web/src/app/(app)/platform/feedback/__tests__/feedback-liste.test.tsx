/**
 * App Feedback (MEL-01): Tabelle und Kanban zeigen dieselbe Menge; gesehen ist
 * ein eigener Zustand neben dem Status. Im Kanban wird gruppiert nach Status
 * oder nach Person, und eine Karte ändert beim Ablegen in einer anderen Spalte
 * ihren Status oder ihre Zuweisung.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Feedback } from "@/lib/feedback";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));

const api = vi.hoisted(() => ({
  liste: vi.fn(),
  konten: vi.fn(),
  status: vi.fn(async () => undefined),
  zuweisen: vi.fn(async () => undefined),
  gesehen: vi.fn(async () => undefined),
  loeschen: vi.fn(async () => undefined),
  bildUrl: vi.fn(async () => "blob:bild"),
}));
vi.mock("@/lib/feedback", async (original) => ({
  ...(await original<typeof import("@/lib/feedback")>()),
  feedbackApi: api,
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { FeedbackListe, ablegen } from "../feedback-liste";

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
    zugewiesen: null,
    ...felder,
  };
}

const MELDUNGEN = [
  meldung("a", { gesehen_am: null, bild_pfad: "u/a.jpg" }),
  meldung("b", { status: "in_bearbeitung", zugewiesen: "u1" }),
  meldung("c", { status: "erledigt" }),
];
const KONTEN = [{ id: "u1", email: "anna@example.com" }];

function zeige() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <FeedbackListe />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

async function kanban() {
  zeige();
  await screen.findByText("Beschreibung a");
  fireEvent.click(screen.getByRole("radio", { name: "Kanban" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.liste.mockResolvedValue(MELDUNGEN);
  api.konten.mockResolvedValue(KONTEN);
});

describe("App Feedback", () => {
  it("zeigt die Tabelle mit den Spalten der Referenz und der Zuweisung", async () => {
    zeige();
    // Erst die Daten: vorher steht in der Tabelle nur die Ladezeile.
    await screen.findByText("Beschreibung a");
    const tabelle = screen.getByRole("table");
    for (const titel of ["Datum", "Von", "Seite", "Beschreibung", "Screenshot", "Status", "Zugewiesen", "Aktionen"]) {
      expect(within(tabelle).getByText(titel)).toBeInTheDocument();
    }
    expect(within(tabelle).getAllByRole("row")).toHaveLength(4);
    expect(within(tabelle).getByRole("combobox", { name: "Status: Beschreibung b" })).toHaveValue("in_bearbeitung");
    expect(await within(tabelle).findByText("anna@example.com")).toBeInTheDocument();
    expect(within(tabelle).getByRole("button", { name: "Öffnen" })).toBeInTheDocument();
  });

  it("ändert den Status auch in der Tabelle und hakt die ungesehene Meldung ab", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    const auswahl = screen.getByRole("combobox", { name: "Status: Beschreibung a" });
    expect(auswahl).toHaveValue("neu");
    fireEvent.change(auswahl, { target: { value: "in_bearbeitung" } });
    await waitFor(() => expect(api.status).toHaveBeenCalledWith("a", "in_bearbeitung"));
    expect(api.gesehen).toHaveBeenCalledWith(["a"]);
    expect(screen.getByRole("combobox", { name: "Status: Beschreibung c" })).toHaveValue("erledigt");
  });

  it("markiert beim bloßen Öffnen nichts als gesehen", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    expect(screen.getAllByRole("button", { name: /ungesehen/ })).toHaveLength(1);
    expect(api.gesehen).not.toHaveBeenCalled();
  });

  it("zeigt im Kanban nach Status die drei Spalten", async () => {
    await kanban();
    const offen = screen.getByRole("region", { name: "offen" });
    const inArbeit = screen.getByRole("region", { name: "In Bearbeitung" });
    const erledigt = screen.getByRole("region", { name: "erledigt" });
    expect(within(offen).getByText("Beschreibung a")).toBeInTheDocument();
    expect(within(inArbeit).getByText("Beschreibung b")).toBeInTheDocument();
    expect(within(erledigt).getByText("Beschreibung c")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /ungesehen/ })).toBeNull();
  });

  it("gruppiert im Kanban umschaltbar nach Person", async () => {
    await kanban();
    fireEvent.click(screen.getByRole("radio", { name: "Person" }));
    const ohne = screen.getByRole("region", { name: "Nicht zugewiesen" });
    const anna = await screen.findByRole("region", { name: "anna@example.com" });
    expect(within(ohne).getByText("Beschreibung a")).toBeInTheDocument();
    expect(within(ohne).getByText("Beschreibung c")).toBeInTheDocument();
    expect(within(anna).getByText("Beschreibung b")).toBeInTheDocument();
  });

  it("jede Karte hat einen Griff zum Verschieben", async () => {
    await kanban();
    expect(screen.getAllByRole("button", { name: /^Verschieben: / })).toHaveLength(3);
  });

  it("der Punkt hakt nur ab, der Status bleibt", async () => {
    zeige();
    await screen.findByText("Beschreibung a");
    fireEvent.click(screen.getByRole("button", { name: /ungesehen/ }));
    await waitFor(() => expect(api.gesehen).toHaveBeenCalledWith(["a"]));
    expect(api.status).not.toHaveBeenCalled();
  });
});

describe("App Feedback in der Schale", () => {
  it("stellt Ansicht und Gruppierung mit Titel in die Kategorie Ansicht", async () => {
    const plaetze = Object.fromEntries(
      ["navigation", "ansicht", "filter", "zeitraum", "aktionen"].map((k) => [
        k,
        document.body.appendChild(document.createElement("div")),
      ]),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={plaetze}>
            <FeedbackListe />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByText("Beschreibung a");
    const ansicht = screen.getByRole("radiogroup", { name: "Ansicht" });
    expect(plaetze.ansicht).toContainElement(ansicht);
    expect(ansicht.parentElement!.firstElementChild!.textContent).toBe("Ansicht");

    fireEvent.click(screen.getByRole("radio", { name: "Kanban" }));
    const gruppieren = screen.getByRole("radiogroup", { name: "Gruppieren nach" });
    expect(plaetze.ansicht).toContainElement(gruppieren);
    expect(gruppieren.parentElement!.firstElementChild!.textContent).toBe("Gruppieren nach");
    Object.values(plaetze).forEach((div) => div.remove());
  });
});

describe("Ablegen im Kanban", () => {
  const a = MELDUNGEN[0];
  const b = MELDUNGEN[1];

  it("in einer anderen Status-Spalte ändert den Status", () => {
    expect(ablegen(a, "status:in_bearbeitung")).toEqual({ status: "in_bearbeitung" });
  });

  it("in einer anderen Person-Spalte ändert die Zuweisung", () => {
    expect(ablegen(a, "person:u1")).toEqual({ zugewiesen: "u1" });
    expect(ablegen(b, "person:ohne")).toEqual({ zugewiesen: null });
  });

  it("in der eigenen Spalte oder daneben ändert nichts", () => {
    expect(ablegen(a, "status:neu")).toBeNull();
    expect(ablegen(b, "person:u1")).toBeNull();
    expect(ablegen(a, null)).toBeNull();
    expect(ablegen(a, "status:gibtesnicht")).toBeNull();
  });
});
