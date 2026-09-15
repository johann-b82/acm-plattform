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

import { FENSTER, sensorApi } from "@/lib/sensoren";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { SensorDashboard } from "../sensor-dashboard";

describe("Sensor-Kachel", () => {
  it("zeigt Wert und Min/Max, aber keine Tendenz zu vor 1 h oder 24 h", async () => {
    vi.mocked(sensorApi.liste).mockResolvedValueOnce([
      {
        id: "s1", name: "Klebeschrank Lager", rechner: "192.9.201.65", port: 161,
        temperatur_oid: "1.2.3", feuchte_oid: "1.2.4", temperatur_faktor: "1", feuchte_faktor: "1",
        aktiv: true, farbe: null,
      },
    ]);
    vi.mocked(sensorApi.stand).mockResolvedValueOnce([
      {
        sensor_id: "s1", gemessen_am: "2026-09-11T21:18:00Z", temperatur: "21.3", feuchte: "59",
        versucht_am: "2026-09-11T21:18:00Z", erfolg: true, fehler: null,
      },
    ]);
    vi.mocked(sensorApi.kennzahlen).mockResolvedValueOnce([
      {
        sensor_id: "s1", gemessen_am: "2026-09-11T21:18:00Z", temperatur: "21.3", feuchte: "59",
        temperatur_min: null, temperatur_max: null, feuchte_min: null, feuchte_max: null,
        temperatur_aenderung_1h: "-0.1", temperatur_aenderung_24h: "-0.5",
        feuchte_aenderung_1h: "0", feuchte_aenderung_24h: "-0.6",
      },
    ]);
    const { findByText, queryByText } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <SensorDashboard />
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const name = await findByText("Klebeschrank Lager");
    expect(name).toBeInTheDocument();
    // Das Farbfeld vor dem Namen ist der Schlüssel zur Linie im Verlauf — eckig.
    const farbfeld = name.parentElement!.querySelector("span[aria-hidden]");
    expect(farbfeld).not.toBeNull();
    expect(farbfeld!.className).not.toMatch(/\brounded/);
    expect(await findByText("21,3 °C")).toBeInTheDocument();
    expect(queryByText(/zu vor 1 h/)).toBeNull();
    expect(queryByText(/zu vor 24 h/)).toBeNull();
    expect(queryByText(/-0,5/)).toBeNull();
  });
});

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
