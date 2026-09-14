/**
 * Die Durchsicht stellt Rückweg, Erzeugen, Herunterladen und den Stand der
 * Erzeugung in die rechte Leiste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { eine, positionen, erzeugen } = vi.hoisted(() => ({
  eine: vi.fn(),
  positionen: vi.fn(),
  erzeugen: vi.fn(),
}));

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/atr", async (original) => {
  const echt = await original<typeof import("@/lib/atr")>();
  return { ...echt, lieferungApi: { ...echt.lieferungApi, eine, positionen, erzeugen } };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import type { AtrPosition, Lieferung } from "@/lib/atr";
import { Durchsicht } from "./durchsicht";

const LIEFERUNG: Lieferung = {
  id: "l1",
  quelle_dateiname: "ls.pdf",
  lieferschein_nr: "LS-1",
  datum: null,
  ba_auftrag: null,
  bestellnummer: null,
  programm: null,
  programm_grund: null,
  bereich: null,
  msn: null,
  bettvariante: null,
  satz_titel: null,
  atr_nummer: null,
  containernummer: null,
  wiegedatum: null,
  pruefdatum: null,
  qs_unterschrift: null,
  max_gewicht_kg: null,
  status: "entwurf" as Lieferung["status"],
  hinweise: [],
  mappe_pfad: null,
  pdf_pfad: null,
  etikett_pfad: null,
  erzeugt_am: null,
  geaendert_am: "2026-09-01T00:00:00Z",
  erstellt_am: "2026-09-01T00:00:00Z",
};

const POSITION = {
  id: "p1",
  lieferung_id: "l1",
  reihenfolge: 1,
  pos: 1,
  lieferantennummer: null,
  teilenummer: "VR-1",
  teilenummer_norm: "1",
  teil_id: "t1",
  bezeichnung: "Teil",
  zeichnung: null,
  kategorie: null,
  menge: 1,
  gewicht_kg: "1.000",
  bestellposition: null,
  seriennummern: [],
} as unknown as AtrPosition;

let platz: HTMLElement;

beforeEach(() => {
  eine.mockResolvedValue(LIEFERUNG);
  positionen.mockResolvedValue([POSITION]);
  erzeugen.mockResolvedValue({ pdf_hinweis: null });
  platz = document.createElement("div");
  document.body.appendChild(platz);
});

afterEach(() => {
  platz.remove();
});

describe("Durchsicht in der Schale", () => {
  it("stellt Rückweg, Erzeugen, Downloads und Stand in die Leiste", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Durchsicht id="l1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByText("Lieferschein LS-1");
    const leiste = within(platz);
    expect(leiste.getByRole("link", { name: "Lieferungen" })).toHaveAttribute("href", "/atr");
    for (const name of ["Mappe", "PDF", "Etikett"]) {
      expect(leiste.getByRole("button", { name })).toBeDisabled();
    }
    expect(leiste.getByText("Noch nichts erzeugt.")).toBeInTheDocument();

    const erzeugenKnopf = await waitFor(() => {
      const k = leiste.getByRole("button", { name: "Dokumente erzeugen" });
      expect(k).toBeEnabled();
      return k;
    });
    expect(container).not.toContainElement(erzeugenKnopf);
    fireEvent.click(erzeugenKnopf);
    await waitFor(() => expect(erzeugen).toHaveBeenCalledWith("l1"));
  });
});
