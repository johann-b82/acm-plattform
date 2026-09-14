/**
 * Ein Audit in der Schale: der Weg zurück zur Übersicht und der Status des
 * ganzen Audits stehen in der rechten Leiste.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Audit } from "@/lib/audit";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));

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
};

const api = vi.hoisted(() => ({
  eines: vi.fn(),
  phasen: vi.fn(async () => []),
  stand: vi.fn(async () => []),
  kategorien: vi.fn(async () => []),
  normen: vi.fn(async () => []),
  normbezug: vi.fn(async () => []),
  verlauf: vi.fn(async () => []),
  aendern: vi.fn(async () => undefined),
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
    await waitFor(() => expect(api.aendern).toHaveBeenCalledWith("a1", { status: "abgeschlossen" }));
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
});
