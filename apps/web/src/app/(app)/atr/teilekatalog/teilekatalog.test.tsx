/**
 * ATR-04/05: Katalogzeilen zuerst lesend, „Bearbeiten“ gibt genau drei Felder
 * frei, erst „Speichern“ speichert, ein Fehler bleibt sichtbar. Die normierte
 * Nummer steht nicht mehr da, sucht aber weiter mit.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { teile, teilAendern, teilAnlegen } = vi.hoisted(() => ({
  teile: vi.fn(),
  teilAendern: vi.fn(),
  teilAnlegen: vi.fn(),
}));

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("@/lib/atr", async (original) => {
  const echt = await original<typeof import("@/lib/atr")>();
  return { ...echt, atrApi: { ...echt.atrApi, teile, teilAendern, teilAnlegen } };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import type { Teil } from "@/lib/atr";
import { Teilekatalog } from "./teilekatalog";

function teil(nr: number, ueber: Partial<Teil> = {}): Teil {
  return {
    id: `t${nr}`,
    teilenummer: `VR-${1000 + nr}-00`,
    teilenummer_norm: `${1000 + nr}00`,
    lieferantennummer: null,
    bezeichnung: `Teil ${nr}`,
    zeichnung: null,
    gewicht_kg: "1.000",
    menge: 1,
    kategorie: "Seat",
    bestellposition: null,
    herkunft: null,
    geaendert_am: "2026-09-01T00:00:00Z",
    ...ueber,
  };
}

const CARPET = teil(0, {
  id: "carpet",
  teilenummer: "103391B45-001",
  teilenummer_norm: "10339145001",
  bezeichnung: "Carpet FWD",
  zeichnung: "D-1/A",
  gewicht_kg: "0.500",
  kategorie: "Carpet",
});

function zeige(darfSchreiben = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SprachAnbieter sprache="de">
        <Teilekatalog darfSchreiben={darfSchreiben} />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  teile.mockReset();
  teilAendern.mockReset();
  teile.mockResolvedValue([CARPET, teil(1)]);
});

describe("Teilekatalog", () => {
  it("zeigt die Zeilen zuerst lesend und ohne die normierte Nummer", async () => {
    zeige();
    expect(await screen.findByText("103391B45-001")).toBeInTheDocument();
    expect(screen.getByText("Carpet FWD")).toBeInTheDocument();
    expect(screen.queryByText("10339145001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bezeichnung 103391B45-001")).not.toBeInTheDocument();
  });

  it("gibt mit Bearbeiten nur drei Felder frei und speichert erst mit Speichern", async () => {
    teilAendern.mockResolvedValue(undefined);
    zeige();
    await screen.findByText("Carpet FWD");
    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]);

    const bezeichnung = screen.getByLabelText("Bezeichnung 103391B45-001");
    expect(screen.getByLabelText("Zeichnung 103391B45-001")).toHaveValue("D-1/A");
    const gewicht = screen.getByLabelText("Gewicht kg 103391B45-001");
    expect(screen.queryByLabelText("Teilenummer 103391B45-001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Kategorie 103391B45-001")).not.toBeInTheDocument();

    fireEvent.change(bezeichnung, { target: { value: "Carpet AFT" } });
    fireEvent.blur(bezeichnung);
    fireEvent.change(gewicht, { target: { value: "0,44" } });
    fireEvent.blur(gewicht);
    expect(teilAendern).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(teilAendern).toHaveBeenCalledWith("carpet", {
        bezeichnung: "Carpet AFT",
        zeichnung: "D-1/A",
        gewicht_kg: "0.44",
      }),
    );
  });

  it("zeigt einen Fehler und lässt die Zeile offen", async () => {
    teilAendern.mockRejectedValue(new Error("fehlt das Recht"));
    zeige();
    await screen.findByText("Carpet FWD");
    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("fehlt das Recht");
    expect(screen.getByLabelText("Bezeichnung 103391B45-001")).toBeInTheDocument();
  });

  it("speichert ein unlesbares Gewicht nicht", async () => {
    zeige();
    await screen.findByText("Carpet FWD");
    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]);
    fireEvent.change(screen.getByLabelText("Gewicht kg 103391B45-001"), {
      target: { value: "ca. 0,4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zahl in kg");
    expect(teilAendern).not.toHaveBeenCalled();
  });

  it("findet über die Ziffern auch eine anders geschriebene Nummer", async () => {
    teile.mockResolvedValue([CARPET, ...Array.from({ length: 26 }, (_, i) => teil(i + 1))]);
    zeige();
    await screen.findByText("Carpet FWD");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "103391/45" } });
    expect(screen.getByText("103391B45-001")).toBeInTheDocument();
    expect(screen.queryByText("VR-1001-00")).not.toBeInTheDocument();
  });

  it("zeigt Lesenden keine Bearbeitung", async () => {
    zeige(false);
    await screen.findByText("Carpet FWD");
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
  });

  it("stellt Anlegen und Mappe einlesen in der Schale in die rechte Leiste", async () => {
    teilAnlegen.mockResolvedValue(undefined);
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Teilekatalog darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByText("Carpet FWD");
    const leiste = within(platz);
    const nummer = leiste.getByLabelText("Teil von Hand anlegen");
    expect(leiste.getByLabelText("Referenzmappe einlesen")).toBeInTheDocument();
    expect(container).not.toContainElement(nummer);

    fireEvent.change(nummer, { target: { value: "VR-9" } });
    fireEvent.click(leiste.getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(teilAnlegen).toHaveBeenCalledWith("VR-9"));
    platz.remove();
  });
});
