/**
 * Die Sensoren-Seite in der Schale: das Zeitfenster steht unter „Zeitraum“ und
 * ist so breit wie die Leiste — der Pfeil sitzt im Feld, nicht daneben.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/sensoren", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/sensoren")>();
  return {
    ...echt,
    sensorApi: {
      liste: vi.fn(async () => []),
      einstellungen: vi.fn(async () => null),
      stand: vi.fn(async () => []),
      kennzahlen: vi.fn(async () => []),
      verlauf: vi.fn(async () => []),
      messen: vi.fn(async () => ({ gemessen: 0, gescheitert: 0, hinweise: [] })),
    },
  };
});

import { FENSTER } from "@/lib/sensoren";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { SensorDashboard } from "../sensor-dashboard";

describe("Sensoren in der Schale", () => {
  it("stellt das Zeitfenster als volle Auswahlliste unter „Zeitraum“", () => {
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
            <SensorDashboard />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const fenster = within(plaetze.zeitraum).getByRole("combobox", { name: "Zeitraum" });
    expect(fenster.className).toContain("w-full");
    expect(fenster).toHaveValue("24");
    const anderes = String(FENSTER.find((f) => f !== 24));
    fireEvent.change(fenster, { target: { value: anderes } });
    expect(fenster).toHaveValue(anderes);
    Object.values(plaetze).forEach((p) => p.remove());
  });
});
