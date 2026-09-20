/**
 * Die Belegschaft: Verteilungen mit Anzahl und Anteil, und die Auswahl eines
 * historischen Stichtags (Jahr/Quartal), auf den Kopfzahl, Verteilungen und
 * Kompetenzquote gemeinsam reagieren.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { belegschaft, verteilung, kompetenz } = vi.hoisted(() => ({
  belegschaft: vi.fn(),
  verteilung: vi.fn(),
  kompetenz: vi.fn(),
}));

vi.mock("@/lib/kpi/personal", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/lib/kpi/personal")>();
  return { ...echt, personalApi: { belegschaft, verteilung, kompetenz } };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Belegschaft } from "../belegschaft";

const VERTEILUNG = [
  { art: "geschlecht", kategorie: "maennlich", anzahl: 3 },
  { art: "geschlecht", kategorie: "weiblich", anzahl: 1 },
  { art: "beschaeftigung", kategorie: "vollzeit", anzahl: 46 },
  { art: "beschaeftigung", kategorie: "extern", anzahl: 4 },
  { art: "abteilung", kategorie: "Production", anzahl: 9 },
  { art: "abteilung", kategorie: "IT", anzahl: 1 },
];

beforeEach(() => {
  belegschaft.mockReset();
  verteilung.mockReset();
  kompetenz.mockReset();
  belegschaft.mockImplementation(async (jahr?: number) =>
    jahr
      ? { stichtag: "2024-12-31", gesamt: 70, neu: 8, bestand: 62 }
      : { stichtag: "2026-09-20", gesamt: 50, neu: 2, bestand: 48 },
  );
  verteilung.mockResolvedValue(VERTEILUNG);
  kompetenz.mockResolvedValue({ mit_kompetenz: 10, aktive: 50, quote: 0.2, eingerichtet: true });
});

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <Belegschaft />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Belegschaft, Verteilungen", () => {
  it("zeigt überall die Anzahl und den Anteil in Klammern", async () => {
    zeige();
    expect(await screen.findByText("3 (75 %)")).toBeInTheDocument();
    expect(screen.getByText("46 (92 %)")).toBeInTheDocument();
    expect(screen.getByText("9 (90 %)")).toBeInTheDocument();
  });

  it("beginnt beim heutigen Stand — ohne Jahr/Quartal-Parameter", async () => {
    zeige();
    await screen.findByText("3 (75 %)");
    expect(belegschaft).toHaveBeenCalledWith(undefined, undefined);
    expect(kompetenz).toHaveBeenCalledWith(undefined);
  });
});

describe("Belegschaft, historischer Stichtag", () => {
  it("lässt ein vergangenes Jahr/Quartal wählen; Kopfzahl, Verteilung und Kompetenz reagieren gemeinsam", async () => {
    zeige();
    await screen.findByText("3 (75 %)");

    // Ein vergangenes Jahr wählen.
    fireEvent.change(screen.getByLabelText("Stichtag"), { target: { value: "2024" } });
    // Das Quartal erscheint und steht auf Q4 (Jahresende).
    const quartal = await screen.findByLabelText("Quartal");
    expect(quartal).toHaveValue("4");

    await waitFor(() => expect(belegschaft).toHaveBeenCalledWith(2024, 4));
    // Verteilung und Kompetenz lesen denselben Stichtag (2024-12-31).
    expect(verteilung).toHaveBeenCalledWith(2024, 4);
    expect(kompetenz).toHaveBeenCalledWith("2024-12-31");

    // Der Referenzfall: 70 Beschäftigte zum 31.12.2024.
    expect(await screen.findByText("70")).toBeInTheDocument();
    expect(screen.getByText(/31\. Dezember 2024/)).toBeInTheDocument();
  });
});
