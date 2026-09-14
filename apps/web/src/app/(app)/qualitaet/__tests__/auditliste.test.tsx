/**
 * Die Auditübersicht in der Schale: die Filter Status und Art und „Neues
 * Audit" gelten für die ganze Liste und stehen deshalb in der rechten Leiste.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("@/lib/audit", async (original) => {
  const echt = await original<typeof import("@/lib/audit")>();
  return {
    ...echt,
    auditApi: {
      ...echt.auditApi,
      liste: vi.fn(async () => []),
      stand: vi.fn(async () => []),
      vorlagen: vi.fn(async () => []),
      alleKategorien: vi.fn(async () => []),
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { Auditliste } from "../auditliste";

afterEach(() => {
  document.body.innerHTML = "";
});

function zeige() {
  const platz = document.createElement("div");
  document.body.appendChild(platz);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={platz}>
          <Auditliste darfSchreiben />
        </Werkzeugplatz.Provider>
      </SprachAnbieter>
    </QueryClientProvider>,
  );
  return platz;
}

describe("Auditliste", () => {
  it("stellt Status, Art und „Neues Audit“ in die rechte Leiste", () => {
    const platz = zeige();
    expect(within(platz).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(platz).getByRole("combobox", { name: "Art" })).toBeInTheDocument();
    fireEvent.click(within(platz).getByRole("button", { name: "Neues Audit" }));
    // Das Formular bleibt im Inhalt.
    expect(screen.getByLabelText("Nummer")).toBeInTheDocument();
    expect(within(platz).queryByLabelText("Nummer")).toBeNull();
  });

  it("ordnet Status und Art den Filtern mit Titel zu, „Neues Audit“ den Aktionen", () => {
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
            <Auditliste darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const { filter, aktionen } = plaetze;
    expect(within(filter).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(filter).getByRole("combobox", { name: "Art" })).toBeInTheDocument();
    // Je Filter genau ein Titel, keine zweite Beschriftung daneben.
    expect(within(filter).getAllByText("Status")).toHaveLength(1);
    expect(within(filter).getAllByText("Art")).toHaveLength(1);
    expect(within(filter).getByText("Status").closest(".text-xs")).not.toBeNull();
    expect(within(aktionen).getByRole("button", { name: "Neues Audit" })).toBeInTheDocument();
    expect(within(filter).queryByRole("button")).toBeNull();
  });
});
