/**
 * Ein Audit in der Schale: der Weg zurück zur Übersicht und der Status des
 * ganzen Audits stehen in der rechten Leiste.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PHASEN_STATUS, type Audit, type Phase } from "@/lib/audit";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
const live = vi.hoisted(() => ({ useLiveTabellen: vi.fn() }));
vi.mock("@/components/realtime/live", () => live);
vi.mock("@/components/realtime/anwesenheit", () => ({
  Anwesenheit: ({ tabelle, kennung }: { tabelle: string; kennung: string }) => (
    <p data-testid="anwesenheit">{`${tabelle}:${kennung}`}</p>
  ),
}));

const AUDIT: Audit = {
  id: "a1",
  nummer: "A-1",
  titel: "Prozessaudit",
  art: "intern",
  bereich: "",
  ziel: "",
  leitender_auditor: null,
  team: "",
  geplant_von: null,
  geplant_bis: null,
  prioritaet: 2,
  status: "geplant",
  vorlage_id: null,
  version: 2,
};

const api = vi.hoisted(() => ({
  eines: vi.fn(),
  phasen: vi.fn(async (): Promise<Phase[]> => []),
  stand: vi.fn(async () => []),
  kategorien: vi.fn(async () => []),
  normen: vi.fn(async () => []),
  normbezug: vi.fn(async () => []),
  verlauf: vi.fn(async () => []),
  aendern: vi.fn(async () => undefined),
  phaseAendern: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audit", async (original) => {
  const echt = await original<typeof import("@/lib/audit")>();
  return { ...echt, auditApi: { ...echt.auditApi, ...api } };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { AuditAnsicht } from "../audit-ansicht";

afterEach(() => {
  document.body.innerHTML = "";
});

function zeige() {
  api.eines.mockResolvedValue(AUDIT);
  const platz = document.createElement("div");
  document.body.appendChild(platz);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={platz}>
          <AuditAnsicht id="a1" darfSchreiben />
        </Werkzeugplatz.Provider>
      </SprachAnbieter>
    </QueryClientProvider>,
  );
  return platz;
}

describe("AuditAnsicht", () => {
  it("stellt „Zur Übersicht“ und den Status des Audits in die rechte Leiste", async () => {
    const platz = zeige();
    const status = await within(platz).findByRole("combobox", { name: "Status" });
    expect(within(platz).getByRole("link", { name: "Zur Übersicht" })).toHaveAttribute("href", "/qualitaet");
    fireEvent.change(status, { target: { value: "abgeschlossen" } });
    // Gespeichert wird mit dem geladenen Audit — samt Version (ADR-0006).
    await waitFor(() => expect(api.aendern).toHaveBeenCalledWith(AUDIT, { status: "abgeschlossen" }));
  });

  it("ordnet „Zur Übersicht“ der Navigation und den Status mit Titel den Aktionen zu", async () => {
    api.eines.mockResolvedValue(AUDIT);
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
            <AuditAnsicht id="a1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const { navigation, aktionen } = plaetze;
    expect(await within(aktionen).findByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(aktionen).getByText("Status")).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Zur Übersicht" })).toHaveAttribute("href", "/qualitaet");
    expect(within(aktionen).queryByRole("link")).toBeNull();
  });

  it("hält Audit und Phasen live und zeigt, wer das Audit noch offen hat", async () => {
    zeige();
    expect(await screen.findByTestId("anwesenheit")).toHaveTextContent("audits:a1");
    expect(live.useLiveTabellen).toHaveBeenCalledWith(["audits", "audit_phasen"]);
  });

  it("speichert die Stammdaten mit der Version, auf der der Entwurf beruht — nicht mit der nachgeladenen", async () => {
    api.eines.mockResolvedValue(AUDIT);
    api.aendern.mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <AuditAnsicht id="a1" darfSchreiben />
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    // Jemand anders speichert das Audit; die Seite lädt live nach.
    api.eines.mockResolvedValue({ ...AUDIT, titel: "Geändert von Zoe", version: 3 });
    await client.invalidateQueries();
    await waitFor(() => expect(screen.queryByText(/Geändert von Zoe/)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.aendern).toHaveBeenCalled());
    // Der Entwurf beruht auf Version 2 — speichern darf er nur auf Version 2,
    // sonst überschriebe er Zoes Titel still.
    expect(api.aendern).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1", version: 2 }),
      expect.anything(),
    );
  });

  it("speichert eine Phase mit der Version, mit der ihre Maske geöffnet wurde", async () => {
    const PHASE: Phase = {
      id: "ph1",
      audit_id: "a1",
      position: 1,
      titel: "Planung",
      beschreibung: "",
      pflicht: false,
      status: PHASEN_STATUS[0].wert,
      verantwortlich: null,
      faellig_am: null,
      erledigt_am: null,
      kommentar: "",
      uebersprungen_warum: null,
      version: 1,
    };
    api.eines.mockResolvedValue(AUDIT);
    api.phasen.mockResolvedValue([PHASE]);
    api.phaseAendern.mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <AuditAnsicht id="a1" darfSchreiben />
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const tabelle = await screen.findByRole("table");
    fireEvent.click(await within(tabelle).findByRole("button", { name: "Bearbeiten" }));
    // Jemand anders speichert dieselbe Phase, während die Maske offen ist.
    const vorher = api.phasen.mock.calls.length;
    api.phasen.mockResolvedValue([{ ...PHASE, kommentar: "von Zoe", version: 4 }]);
    await client.invalidateQueries();
    await waitFor(() => expect(api.phasen.mock.calls.length).toBeGreaterThan(vorher));
    fireEvent.click(within(tabelle).getByRole("button", { name: /speichern/i }));
    await waitFor(() => expect(api.phaseAendern).toHaveBeenCalled());
    expect(api.phaseAendern).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ph1", version: 1 }),
      expect.anything(),
    );
  });
});
