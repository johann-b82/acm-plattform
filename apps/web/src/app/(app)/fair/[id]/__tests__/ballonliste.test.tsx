/**
 * Prüfliste im DOM: Verschieben nur in der Nummernfolge (FAI-06) und OCR je
 * Zeile ohne ungefragtes Überschreiben (FAI-05).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const api = vi.hoisted(() => ({
  reihenfolge: vi.fn(async () => undefined),
  ballonAendern: vi.fn(async () => undefined),
  ballonLoeschen: vi.fn(async () => undefined),
}));
vi.mock("@/lib/fair", () => ({
  fairApi: api,
  fairKeys: { ballons: (id: string) => ["fair", "ballons", id] },
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import type { Ballon } from "@/lib/fair";
import { Ballonliste } from "../ballonliste";

function ballon(nummer: number, wert: string): Ballon {
  return {
    id: `b${nummer}`,
    zeichnung_id: "z",
    nummer,
    seite: 1,
    bereich_x: 0.1,
    bereich_y: 0.1,
    bereich_b: 0.1,
    bereich_h: 0.1,
    blase_x: 0.5,
    blase_y: 0.5,
    wert,
  };
}

const BALLONS = [ballon(1, "30"), ballon(2, ""), ballon(3, "10")];

function zeige(onOcr: (b: Ballon) => Promise<string> = async () => "") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SprachAnbieter sprache="de">
        <Ballonliste
          zeichnungId="z"
          ballons={BALLONS}
          gewaehlt={null}
          darfSchreiben
          mehrereSeiten={false}
          pdfLaeuft={false}
          onWaehlen={() => undefined}
          onOcr={onOcr}
          onPdf={() => undefined}
        />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom kennt das modale <dialog> nicht.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe("Prüfliste", () => {
  it("zeigt je Zeile einen Ziehgriff und schickt beim Verschieben alle Kennungen", async () => {
    zeige();
    expect(screen.getByRole("button", { name: "Nummer 2 ziehen, um sie zu verschieben" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Nummer 3 nach oben" }));
    await waitFor(() => expect(api.reihenfolge).toHaveBeenCalledWith("z", ["b1", "b3", "b2"]));
  });

  it("sperrt Griffe und Pfeile, solange nach Wert sortiert ist, und sagt warum", () => {
    zeige();
    fireEvent.click(screen.getByRole("button", { name: /^Wert/ }));
    expect(screen.getByText(/Verschieben geht nur in der Nummernfolge/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nummer 2 ziehen, um sie zu verschieben" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nummer 3 nach oben" })).toBeDisabled();
  });

  it("gibt das Verschieben nach Nr aufsteigend wieder frei", () => {
    zeige();
    const nr = screen.getByRole("button", { name: /^Nr/ });
    fireEvent.click(nr); // absteigend
    expect(screen.getByRole("button", { name: "Nummer 3 nach oben" })).toBeDisabled();
    fireEvent.click(nr); // aufsteigend = Nummernfolge
    expect(screen.getByRole("button", { name: "Nummer 3 nach oben" })).toBeEnabled();
  });

  it("OCR füllt ein leeres Feld direkt, nur in dieser Zeile", async () => {
    const onOcr = vi.fn(async () => "12,5");
    zeige(onOcr);
    const zeile = screen.getByRole("textbox", { name: "Wert zu Nummer 2" }).closest("tr")!;
    fireEvent.click(within(zeile).getByRole("button", { name: "OCR für diese Zeile neu starten" }));
    await waitFor(() => expect(api.ballonAendern).toHaveBeenCalledWith("b2", { wert: "12,5" }));
    expect(onOcr).toHaveBeenCalledTimes(1);
    expect(onOcr).toHaveBeenCalledWith(BALLONS[1]);
  });

  it("OCR fragt, bevor ein vorhandener anderer Wert ersetzt wird", async () => {
    zeige(async () => "31");
    const zeile = screen.getByRole("textbox", { name: "Wert zu Nummer 1" }).closest("tr")!;
    fireEvent.click(within(zeile).getByRole("button", { name: "OCR für diese Zeile neu starten" }));
    expect(await screen.findByText("Nummer 1: „30“ durch „31“ ersetzen?")).toBeInTheDocument();
    expect(api.ballonAendern).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ersetzen", hidden: true }));
    await waitFor(() => expect(api.ballonAendern).toHaveBeenCalledWith("b1", { wert: "31" }));
  });
});
