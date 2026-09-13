/**
 * KPI-Bewertung & Maßnahmen (MAS-01): Aufbau wie im Altsystem, Statusfilter
 * mit „in Arbeit“, Anlage mit Priorität und Bubble-Zuordnung, Leseansicht.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Bubble, Massnahme, Uebersichtszeile } from "@/lib/kpi/bewertung";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ usePathname: () => "/kpi/bewertung" }));

const api = vi.hoisted(() => ({
  uebersicht: vi.fn(),
  bubbles: vi.fn(),
  massnahmen: vi.fn(),
  verantwortliche: vi.fn(),
  massnahmeAnlegen: vi.fn(async () => undefined),
  massnahmeAendern: vi.fn(async () => undefined),
  massnahmeLoeschen: vi.fn(async () => undefined),
  bubbleGesehen: vi.fn(async () => undefined),
  bubbleLoeschen: vi.fn(async () => undefined),
}));
vi.mock("@/lib/kpi/bewertung", async (original) => ({
  ...(await original<typeof import("@/lib/kpi/bewertung")>()),
  bewertungApi: api,
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { BewertungSeite } from "../bewertung";

const KENNZAHLEN: Uebersichtszeile[] = [
  { schluessel: "qualitaet_audit_level1", bereich: "qualitaet", label: "Audit-Findings Level 1", kommentare: 0, letzter_kommentar: null, offen: 1, ueberfaellig: 1, erledigt: 0 },
  { schluessel: "einkauf_otd", bereich: "einkauf", label: "Liefertermintreue", kommentare: 1, letzter_kommentar: null, offen: 0, ueberfaellig: 0, erledigt: 0 },
];

function massnahme(id: string, felder: Partial<Massnahme>): Massnahme {
  return {
    id,
    schluessel: "qualitaet_audit_level1",
    titel: id,
    beschreibung: null,
    zustaendig: null,
    faellig_am: null,
    status: "offen",
    prioritaet: "mittel",
    kommentar_id: null,
    erledigt_am: null,
    erstellt_am: "2026-08-19T14:29:58Z",
    geaendert_am: "2026-08-19T14:29:58Z",
    ...felder,
  };
}

const BUBBLES: Bubble[] = [
  { id: "b1", schluessel: null, bereich: "einkauf", nummer: 1, text: "Knick im Juli", ampel: "rot", pos_x: 0.1, pos_y: 0.2, breite: 0.2, hoehe: 0.1, verfasser_email: "u@example.com", gesehen_am: null, erstellt_am: "2026-09-10T10:00:00Z" },
  { id: "b2", schluessel: "qualitaet_audit_level1", bereich: "qualitaet", nummer: 1, text: "Alter Kommentar", ampel: null, pos_x: null, pos_y: null, breite: null, hoehe: null, verfasser_email: null, gesehen_am: "2026-09-10T10:00:00Z", erstellt_am: "2026-08-01T10:00:00Z" },
];

function zeige(darfSchreiben: boolean) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <BewertungSeite darfSchreiben={darfSchreiben} />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.uebersicht.mockResolvedValue(KENNZAHLEN);
  api.bubbles.mockResolvedValue(BUBBLES);
  api.verantwortliche.mockResolvedValue(["Adler, Anna", "Brose, Marcel"]);
  api.massnahmen.mockResolvedValue([
    massnahme("Test", { zustaendig: "Brose, Marcel", faellig_am: "2026-08-19" }),
    massnahme("Läuft schon", { schluessel: "einkauf_otd", status: "laeuft", prioritaet: "hoch" }),
  ]);
});

describe("KPI-Bewertung & Maßnahmen", () => {
  it("zeigt Lesenden nur die Tabelle, ohne Bubbles, Formular und Bedienelemente", async () => {
    zeige(false);
    const tabelle = await screen.findByRole("table", { name: "Maßnahmen" });
    await within(tabelle).findByText("Audit-Findings Level 1");
    for (const titel of ["KPI", "Maßnahme", "Verantwortlich", "Fällig", "Priorität", "Status"]) {
      expect(within(tabelle).getByText(titel)).toBeInTheDocument();
    }
    expect(within(tabelle).queryByText("Aktionen")).toBeNull();
    expect(within(tabelle).getByText("Brose, Marcel")).toBeInTheDocument();
    expect(within(tabelle).getByText("in Arbeit")).toBeInTheDocument();
    expect(screen.queryByText("Neue Maßnahme")).toBeNull();
    expect(screen.queryByText("Knick im Juli")).toBeNull();
    expect(api.verantwortliche).not.toHaveBeenCalled();
  });

  it("zeigt Schreibenden Bubbles, Formular und Tabelle in dieser Reihenfolge", async () => {
    zeige(true);
    const bubbles = await screen.findByText("Knick im Juli");
    const formular = screen.getByText("Neue Maßnahme");
    const tabelle = screen.getByRole("table", { name: "Maßnahmen" });
    expect(bubbles.compareDocumentPosition(formular) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(formular.compareDocumentPosition(tabelle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Ein Kommentar aus der Zeit vor den Bubbles steht als Bubble ohne Position da.
    expect(screen.getByText("Alter Kommentar")).toBeInTheDocument();
    expect(screen.getByText(/ohne Position im Diagramm/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zum Dashboard: Einkauf/ })).toHaveAttribute("href", "/kpi/einkauf");
  });

  it("filtert nach „in Arbeit“ und bietet genau die Status der Referenz", async () => {
    zeige(false);
    const filter = await screen.findByRole("combobox", { name: "Nach Status filtern" });
    expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Alle Status", "offen", "in Arbeit", "erledigt", "verworfen",
    ]);
    const tabelle = screen.getByRole("table", { name: "Maßnahmen" });
    await within(tabelle).findByText("Test");
    fireEvent.change(filter, { target: { value: "laeuft" } });
    expect(within(tabelle).queryByText("Test")).toBeNull();
    expect(within(tabelle).getByText("Läuft schon")).toBeInTheDocument();
  });

  it("legt eine Maßnahme mit Priorität mittel an und bietet Bubbles des Bereichs an", async () => {
    zeige(true);
    await screen.findByText("Knick im Juli");
    // Nur im Formular suchen: der Spaltenkopf „Maßnahme“ ist auch ein Knopf.
    const formular = screen.getByText("Neue Maßnahme").parentElement!;
    const anlegen = within(formular).getByRole("button", { name: /Maßnahme/ });
    expect(anlegen).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "KPI" }), { target: { value: "einkauf_otd" } });
    const bubbleWahl = screen.getByRole("combobox", { name: "Bubbles" });
    expect(within(bubbleWahl).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "— ohne Bubble —", "#1 — Knick im Juli",
    ]);
    fireEvent.change(bubbleWahl, { target: { value: "b1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Maßnahme" }), { target: { value: "Lieferanten anschreiben" } });
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Adler, Anna" }).length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("combobox", { name: "Verantwortlich" })[0], { target: { value: "Adler, Anna" } });
    expect(anlegen).toBeEnabled();
    fireEvent.click(anlegen);

    await waitFor(() =>
      expect(api.massnahmeAnlegen).toHaveBeenCalledWith({
        schluessel: "einkauf_otd",
        kommentar_id: "b1",
        titel: "Lieferanten anschreiben",
        zustaendig: "Adler, Anna",
        faellig_am: null,
        prioritaet: "mittel",
      }),
    );
  });

  it("ändert den Status direkt in der Zeile", async () => {
    zeige(true);
    const status = await screen.findByRole("combobox", { name: "Status: Test" });
    fireEvent.change(status, { target: { value: "laeuft" } });
    await waitFor(() => expect(api.massnahmeAendern).toHaveBeenCalledWith("Test", { status: "laeuft" }));
  });
});
