/**
 * Die Finanzseite im DOM: Umschalter Material/Personal links (FIN-04), je
 * Auswahl nur deren Kacheln, Diagramme und Tabellen, der Zeitraum bleibt beim
 * Wechsel. Personalkosten je Abteilung ohne Sammelzeile (FIN-05), und „Alles"
 * zeigt die Personalkostenquote ohne Wert mit Hinweis (PRF-01, E-03).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  materialkosten: vi.fn(async () => ({ quote: 0.0246, materialkosten: 117091, umsatz: 4760703, ohne_preis: 489 })),
  verlauf: vi.fn(async () => []),
  verbrauch: vi.fn(async () => [
    { artikelnr: "A-1", article_name: "Schraube", menge: 10, stueckpreis: 1.5, kosten: 15 },
  ]),
  personalkosten: vi.fn(async () => ({ personalkosten: 1404417, umsatz: 4760703, quote: 0.295, personen: 70 })),
  personalkostenJeAbteilung: vi.fn(async () => [
    { abteilung: "Production", kosten: 659858, personen: 43 },
    { abteilung: "Quality Assurance", kosten: 60551, personen: 3 },
    { abteilung: "IT", kosten: 5000, personen: 1 },
  ]),
  personalVerlauf: vi.fn(async () => []),
}));

vi.mock("@/lib/kpi/finanzen", () => ({ finanzenApi: api }));
vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/components/kpi/datenstand", () => ({ Datenstand: () => null }));
vi.mock("@/lib/zielwerte", () => ({
  ladeZielwerte: async () => [],
  nachSchluessel: () => ({}),
  zielwerteKeys: { alle: () => ["zielwerte"] },
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { FinanzenDashboard } from "../finanzen-dashboard";

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <FinanzenDashboard />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

const umschalter = () => screen.getByRole("radiogroup", { name: "Ansicht" });

describe("Finanzen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startet mit Material und zeigt nur dessen Inhalte", async () => {
    zeige();
    expect(within(umschalter()).getByRole("radio", { name: "Material" })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("Materialverbrauch je Artikel")).toBeInTheDocument();
    expect(screen.getByText("Artikel ohne Preis")).toBeInTheDocument();
    expect(screen.queryByText("Personalkostenquote")).not.toBeInTheDocument();
    expect(screen.queryByText("Personalkosten je Abteilung")).not.toBeInTheDocument();
    expect(api.personalkosten).not.toHaveBeenCalled();
  });

  it("zeigt bei Personal nur Personal, und der Zeitraum bleibt", async () => {
    zeige();
    const auswahl = screen.getByRole("combobox");
    fireEvent.change(auswahl, { target: { value: "quartal" } });
    await screen.findByText("Materialverbrauch je Artikel");
    const materialFenster = api.materialkosten.mock.calls.at(-1)!;

    fireEvent.click(within(umschalter()).getByRole("radio", { name: "Personal" }));

    expect(screen.getByRole("combobox")).toHaveValue("quartal");
    expect(await screen.findByText("Personalkosten je Abteilung")).toBeInTheDocument();
    expect(screen.getByText("Personalkostenquote")).toBeInTheDocument();
    expect(screen.getByText("Mitarbeiter")).toBeInTheDocument();
    expect(screen.queryByText("Materialverbrauch je Artikel")).not.toBeInTheDocument();
    expect(screen.queryByText("Artikel ohne Preis")).not.toBeInTheDocument();
    expect(screen.queryByText("Materialkostenquote")).not.toBeInTheDocument();
    expect(api.personalkosten).toHaveBeenCalledWith(...materialFenster);
  });

  it("führt jede Abteilung einzeln, auch mit einer Person", async () => {
    zeige();
    fireEvent.click(within(umschalter()).getByRole("radio", { name: "Personal" }));
    const tabelle = await screen.findByRole("table", { name: "Personalkosten je Abteilung" });
    expect(await within(tabelle).findByText("IT")).toBeInTheDocument();
    expect(within(tabelle).getByText("Quality Assurance")).toBeInTheDocument();
    expect(within(tabelle).queryByText("Übrige")).not.toBeInTheDocument();
    // Jede Datenspalte sortiert (TAB-02).
    expect(within(tabelle).getAllByRole("button")).toHaveLength(4);
  });

  it("zeigt bei „Alles“ die Personalkostenquote ohne Wert mit Hinweis", async () => {
    zeige();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alles" } });
    fireEvent.click(within(umschalter()).getByRole("radio", { name: "Personal" }));
    // Quote, Personalkosten, Umsatz und Mitarbeiter — keine Kachel erfindet einen Wert.
    expect(await screen.findAllByText("braucht einen Zeitraum")).toHaveLength(4);
    expect(api.personalkosten).not.toHaveBeenCalled();
    expect(screen.queryByText("Personalkosten je Abteilung")).not.toBeInTheDocument();
  });

  it("stellt Material/Personal in der Schale mit Titel in die Ansicht", () => {
    const plaetze = {
      navigation: document.createElement("div"),
      ansicht: document.createElement("div"),
      filter: document.createElement("div"),
      zeitraum: document.createElement("div"),
      aktionen: document.createElement("div"),
    };
    Object.values(plaetze).forEach((p) => document.body.appendChild(p));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={plaetze}>
            <FinanzenDashboard />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const { ansicht } = plaetze;
    expect(within(ansicht).getByRole("radiogroup", { name: "Ansicht" })).toBeInTheDocument();
    expect(within(ansicht).getByText("Ansicht")).toBeInTheDocument();
    Object.values(plaetze).forEach((p) => p.remove());
  });

  it("rechnet Material bei „Alles“ über den ganzen Bestand", async () => {
    zeige();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alles" } });
    await screen.findByText("Materialverbrauch je Artikel");
    expect(api.materialkosten).toHaveBeenCalledWith(null, null);
    expect(api.verbrauch).toHaveBeenCalledWith(null, null);
  });
});
