/**
 * Die Qualitätsseite im DOM: der Filter Auditart steht in derselben Zeile wie
 * der Umschalter Audits/Reklamationen/Qualitätsprüfung und nur bei Audits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/kpi/qualitaet", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/kpi/qualitaet")>();
  return {
    ...echt,
    qualitaetApi: {
      audits: vi.fn(async () => ({ level_1: 3, level_2: 9, ohne_level: 0 })),
      verlauf: vi.fn(async () => [
        { bucket: "2026-01-01", art: "BH AUD", level_1: 2, level_2: 5 },
        { bucket: "2026-01-01", art: "IN AUD", level_1: 1, level_2: 0 },
        { bucket: "2026-03-01", art: "KU AUD", level_1: 0, level_2: 4 },
      ]),
      liste: vi.fn(async () => []),
    },
    pruefungApi: {
      mengen: vi.fn(async () => []),
      verlauf: vi.fn(async () => []),
      buchungen: vi.fn(async () => []),
    },
    reklamationApi: {
      quote: vi.fn(async () => null),
      verlauf: vi.fn(async () => []),
      liste: vi.fn(async () => []),
    },
  };
});
vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/components/kpi/datenstand", () => ({ Datenstand: () => null }));
vi.mock("@/lib/zielwerte", () => ({
  ladeZielwerte: async () => [],
  nachSchluessel: () => ({}),
  zielwerteKeys: { alle: () => ["zielwerte"] },
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { QualitaetDashboard } from "../qualitaet-dashboard";

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <QualitaetDashboard />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Qualität", () => {
  it("stellt die Auditart in dieselbe Zeile wie den Umschalter der Ansicht", () => {
    zeige();
    const umschalter = screen.getByRole("radiogroup", { name: "Ansicht" });
    const zeile = umschalter.parentElement!;
    expect(within(zeile).getByText("Auditart:")).toBeInTheDocument();
    expect(within(zeile).getByRole("checkbox", { name: "Behörde" })).toBeInTheDocument();
  });

  it("nennt die Auditart EX AUD „Unterlieferant“, nicht mehr „Extern“", () => {
    zeige();
    const zeile = screen.getByRole("radiogroup", { name: "Ansicht" }).parentElement!;
    // Die vier Arten stehen als Ankreuzkästchen; nur das Label von EX AUD ändert
    // sich, der Code bleibt (keine Datenmigration).
    expect(within(zeile).getByRole("checkbox", { name: "Unterlieferant" })).toBeInTheDocument();
    expect(within(zeile).queryByRole("checkbox", { name: "Extern" })).toBeNull();
    for (const art of ["Behörde", "Intern", "Kunde"]) {
      expect(within(zeile).getByRole("checkbox", { name: art })).toBeInTheDocument();
    }
  });

  it("stellt bei der Qualitätsprüfung die Artikelart in dieselbe Zeile wie den Umschalter", () => {
    zeige();
    const umschalter = screen.getByRole("radiogroup", { name: "Ansicht" });
    fireEvent.click(within(umschalter).getByRole("radio", { name: "Qualitätsprüfung" }));
    const artikelart = screen.getByRole("radio", { name: "Fertigartikel" }).closest('[role="radiogroup"]');
    expect(artikelart?.parentElement).toBe(umschalter.parentElement);
  });

  it("stellt die Reklamationsart in der Schale in die rechte Leiste, die Mengenart bleibt an der Kachel", () => {
    const platz = document.createElement("div");
    document.body.appendChild(platz);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <QualitaetDashboard />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    fireEvent.change(within(platz).getByRole("combobox", { name: "Ansicht" }), { target: { value: "reklamationen" } });
    const art = within(platz).getByRole("combobox", { name: "Reklamationsart" });
    fireEvent.change(art, { target: { value: "intern" } });
    expect(art).toHaveValue("intern");
    expect(within(platz).queryByRole("button", { name: "gemeldete Menge" })).toBeNull();
    expect(screen.getByRole("button", { name: "gemeldete Menge" })).toBeInTheDocument();
    platz.remove();
  });

  describe("in der Schale mit Kategorien", () => {
    function zeigeInSchale() {
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
              <QualitaetDashboard />
            </Werkzeugplatz.Provider>
          </SprachAnbieter>
        </QueryClientProvider>,
      );
      return plaetze;
    }

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("stellt den Umschalter mit Titel in die Ansicht, die Auditart mit Titel in die Filter", () => {
      const { ansicht, filter } = zeigeInSchale();
      // In der Leiste eine Auswahlliste; der Titel entfällt, er stünde gleich
      // unter der Kategorie „Ansicht“.
      expect(within(ansicht).getByRole("combobox", { name: "Ansicht" })).toBeInTheDocument();
      expect(within(ansicht).queryByText("Ansicht")).toBeNull();
      expect(within(filter).getByRole("checkbox", { name: "Behörde" })).toBeInTheDocument();
      // Titel ohne Doppelpunkt, keine zweite Beschriftung.
      expect(within(filter).getByText("Auditart")).toBeInTheDocument();
      expect(within(filter).queryByText("Auditart:")).toBeNull();
      expect(within(ansicht).queryByRole("checkbox", { name: "Behörde" })).toBeNull();
    });

    it("stellt die Artikelart mit Titel in die Filter", () => {
      const { ansicht, filter } = zeigeInSchale();
      fireEvent.change(within(ansicht).getByRole("combobox", { name: "Ansicht" }), { target: { value: "pruefung" } });
      const artikelart = within(filter).getByRole("combobox", { name: "Artikelart" });
      expect(artikelart).toHaveValue("fertig");
      expect(within(filter).getByText("Artikelart")).toBeInTheDocument();
      expect(within(ansicht).queryByRole("combobox", { name: "Artikelart" })).toBeNull();
    });

    it("stellt die Reklamationsart mit Titel in die Filter", () => {
      const { ansicht, filter } = zeigeInSchale();
      fireEvent.change(within(ansicht).getByRole("combobox", { name: "Ansicht" }), { target: { value: "reklamationen" } });
      expect(within(filter).getByRole("combobox", { name: "Reklamationsart" })).toHaveValue("kunde");
      expect(within(filter).getByText("Reklamationsart")).toBeInTheDocument();
      expect(within(ansicht).queryByRole("combobox", { name: "Reklamationsart" })).toBeNull();
    });
  });

  it("zeigt keinen erklärenden Satz über der Seite", () => {
    zeige();
    expect(screen.queryByText("Audit-Findings, Reklamationsquote und Prüfmengen.")).toBeNull();
  });

  it("zeigt die Auditart nur bei Audits", () => {
    zeige();
    const umschalter = screen.getByRole("radiogroup", { name: "Ansicht" });
    fireEvent.click(within(umschalter).getByRole("radio", { name: "Reklamationen" }));
    expect(screen.queryByRole("checkbox", { name: "Behörde" })).not.toBeInTheDocument();
  });
});

describe("Audit-Findings im Zeitverlauf", () => {
  it("zeigt je Level ein Diagramm mit den Auditarten in der Legende", async () => {
    zeige();
    // Zwei Karten statt einer Karte mit Level 1 gegen Level 2.
    expect(
      await screen.findByText("Audit-Findings Level 1 im Zeitverlauf"),
    ).toBeInTheDocument();
    expect(screen.getByText("Audit-Findings Level 2 im Zeitverlauf")).toBeInTheDocument();
    expect(screen.queryByText("Audit-Findings im Zeitverlauf")).toBeNull();
  });
});
