/**
 * Die Durchsicht stellt Rückweg, Erzeugen, Herunterladen und den Stand der
 * Erzeugung in die rechte Leiste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { eine, positionen, erzeugen, positionAendern, ablegen } = vi.hoisted(() => ({
  eine: vi.fn(),
  positionen: vi.fn(),
  erzeugen: vi.fn(),
  positionAendern: vi.fn(),
  ablegen: vi.fn(),
}));

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
const live = vi.hoisted(() => ({ useLiveTabellen: vi.fn() }));
vi.mock("@/components/realtime/live", () => live);
vi.mock("@/components/realtime/anwesenheit", () => ({
  Anwesenheit: ({ tabelle, kennung }: { tabelle: string; kennung: string }) => (
    <p data-testid="anwesenheit">{`${tabelle}:${kennung}`}</p>
  ),
}));
vi.mock("@/lib/atr", async (original) => {
  const echt = await original<typeof import("@/lib/atr")>();
  return { ...echt, lieferungApi: { ...echt.lieferungApi, eine, positionen, erzeugen, positionAendern, ablegen } };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz, type Kategorie } from "@/components/sidebar/werkzeugplatz";
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
  version: 3,
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
  version: 1,
} as unknown as AtrPosition;

let platz: Record<Kategorie, HTMLElement>;

beforeEach(() => {
  // Die Toast-Attrappe ist modulweit: ohne Zurücksetzen sähe ein Test die
  // Erfolgsmeldung des vorigen und hielte einen Teilerfolg für gelungen.
  vi.clearAllMocks();
  eine.mockResolvedValue(LIEFERUNG);
  positionen.mockResolvedValue([POSITION]);
  erzeugen.mockResolvedValue({ pdf_hinweis: null });
  const neu = () => document.body.appendChild(document.createElement("div"));
  platz = { navigation: neu(), ansicht: neu(), filter: neu(), zeitraum: neu(), aktionen: neu() };
});

afterEach(() => {
  Object.values(platz).forEach((p) => p.remove());
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
    expect(within(platz.navigation).getByRole("link", { name: "Lieferungen" })).toHaveAttribute(
      "href",
      "/atr",
    );
    const leiste = within(platz.aktionen);
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
    // Die Downloads und der Rückweg sind Knöpfe wie „Dokumente erzeugen“, keine Textzeilen.
    for (const name of ["Mappe", "PDF", "Etikett"]) {
      expect(leiste.getByRole("button", { name }).className).toBe(erzeugenKnopf.className);
    }
    expect(within(platz.navigation).getByRole("link", { name: "Lieferungen" }).className).toBe(
      erzeugenKnopf.className,
    );
    fireEvent.click(erzeugenKnopf);
    await waitFor(() => expect(erzeugen).toHaveBeenCalledWith("l1"));
  });

  describe("Auf Server speichern", () => {
    const ERZEUGT = {
      ...LIEFERUNG,
      mappe_pfad: "l1/ATR.xlsx",
      pdf_pfad: "l1/ATR.pdf",
      etikett_pfad: "l1/Etikett.docx",
      erzeugt_am: "2026-09-02T00:00:00Z",
    };

    function zeige() {
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SprachAnbieter sprache="de">
            <Werkzeugplatz.Provider value={platz}>
              <Durchsicht id="l1" darfSchreiben />
            </Werkzeugplatz.Provider>
          </SprachAnbieter>
        </QueryClientProvider>,
      );
    }

    it("bleibt unsichtbar, solange es nichts abzulegen gibt", async () => {
      // LIEFERUNG trägt weder Mappe noch PDF.
      zeige();
      await screen.findByText("Lieferschein LS-1");
      expect(
        within(platz.aktionen).queryByRole("button", { name: "Auf Server speichern" }),
      ).toBeNull();
    });

    it("bleibt unsichtbar, wenn das PDF beim Erzeugen gescheitert ist", async () => {
      // Das PDF darf fehlschlagen, ohne Mappe und Etikett mitzunehmen — dann
      // ist aber nichts abzulegen, und der Endpunkt wiese es ohnehin ab.
      eine.mockResolvedValue({ ...ERZEUGT, pdf_pfad: null });
      zeige();
      await screen.findByText("Lieferschein LS-1");
      expect(
        within(platz.aktionen).queryByRole("button", { name: "Auf Server speichern" }),
      ).toBeNull();
    });

    it("legt ab und meldet Erfolg, wenn alle drei Ziele stehen", async () => {
      const { toast } = await import("sonner");
      eine.mockResolvedValue(ERZEUGT);
      ablegen.mockResolvedValue({
        abgelegt: [
          { bezeichnung: "QS – Acceptance Test Report (A350)", pfad: "…", dateiname: "a.xlsx" },
          { bezeichnung: "Logistik – Versand", pfad: "…", dateiname: "a.pdf" },
          { bezeichnung: "QS – Weight Report (verschicken)", pfad: "…", dateiname: "a.pdf" },
        ],
        gescheitert: [],
      });
      zeige();
      await screen.findByText("Lieferschein LS-1");
      const knopf = within(platz.aktionen).getByRole("button", {
        name: "Auf Server speichern",
      });
      fireEvent.click(knopf);
      await waitFor(() => expect(ablegen).toHaveBeenCalledWith("l1"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Auf dem Server abgelegt."),
      );
    });

    it("nennt die gescheiterten Ziele beim Namen, statt Erfolg zu melden", async () => {
      // Die drei Ordner gehören verschiedenen Abteilungen. Gelingt nur ein
      // Teil, wäre eine Erfolgsmeldung gelogen — und niemand wüsste, welches
      // Dokument nachzureichen ist.
      const { toast } = await import("sonner");
      eine.mockResolvedValue(ERZEUGT);
      ablegen.mockResolvedValue({
        abgelegt: [
          { bezeichnung: "QS – Acceptance Test Report (A350)", pfad: "…", dateiname: "a.xlsx" },
        ],
        gescheitert: [
          { bezeichnung: "Logistik – Versand", fehler: "kein Zugriff" },
          { bezeichnung: "QS – Weight Report (verschicken)", fehler: "kein Zugriff" },
        ],
      });
      zeige();
      await screen.findByText("Lieferschein LS-1");
      fireEvent.click(
        within(platz.aktionen).getByRole("button", { name: "Auf Server speichern" }),
      );
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Nicht abgelegt: Logistik – Versand, QS – Weight Report (verschicken)",
        ),
      );
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  it("hält Lieferung und Positionen live und zeigt, wer die Lieferung noch offen hat", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Durchsicht id="l1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    await screen.findByText("Lieferschein LS-1");
    expect(live.useLiveTabellen).toHaveBeenCalledWith(["atr_lieferungen", "atr_positionen"]);
    expect(screen.getByTestId("anwesenheit")).toHaveTextContent("atr_lieferungen:l1");
  });

  it("speichert zwei schnelle Änderungen derselben Position nacheinander, jede mit der neuesten Version", async () => {
    // Die Datenbank zählt die Version; die Positionen kommen mit dem aktuellen Stand.
    let stand = 1;
    positionAendern.mockImplementation(async () => ++stand);
    positionen.mockImplementation(async () => [{ ...POSITION, version: stand }]);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Durchsicht id="l1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    const feld = await screen.findByDisplayValue("Teil");
    // Wer von Feld zu Feld springt, speichert schneller, als die Liste neu lädt —
    // das darf nicht als Konflikt mit sich selbst enden.
    fireEvent.change(feld, { target: { value: "A" } });
    fireEvent.blur(feld);
    fireEvent.change(feld, { target: { value: "B" } });
    fireEvent.blur(feld);
    await waitFor(() => expect(positionAendern).toHaveBeenCalledTimes(2));
    expect(positionAendern).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "p1", version: 1 }),
      { bezeichnung: "A" },
    );
    expect(positionAendern).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "p1", version: 2 }),
      { bezeichnung: "B" },
    );
  });

  function zeigeMitClient() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SprachAnbieter sprache="de">
          <Werkzeugplatz.Provider value={platz}>
            <Durchsicht id="l1" darfSchreiben />
          </Werkzeugplatz.Provider>
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    return client;
  }

  it("speichert mit der Version beim Betreten des Feldes — eine fremde Änderung dazwischen fällt auf", async () => {
    let stand = 1;
    positionAendern.mockReset();
    positionAendern.mockImplementation(async () => ++stand);
    positionen.mockImplementation(async () => [{ ...POSITION, version: stand }]);
    const client = zeigeMitClient();
    const feld = await screen.findByDisplayValue("Teil");
    fireEvent.focus(feld);
    // Jemand anders ändert die Position, während hier getippt wird; die Liste lädt live nach.
    const vorher = positionen.mock.calls.length;
    stand = 5;
    await client.invalidateQueries();
    await waitFor(() => expect(positionen.mock.calls.length).toBeGreaterThan(vorher));
    fireEvent.change(feld, { target: { value: "Meins" } });
    fireEvent.blur(feld);
    await waitFor(() => expect(positionAendern).toHaveBeenCalledTimes(1));
    // Mit Version 1 — die Datenbank weist das ab, und die Seite meldet den Konflikt.
    expect(positionAendern).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", version: 1 }),
      { bezeichnung: "Meins" },
    );
  });

  it("zeigt eine fremde Änderung in einem Feld, das gerade niemand bearbeitet", async () => {
    let bezeichnung = "Teil";
    let stand = 1;
    positionen.mockImplementation(async () => [{ ...POSITION, bezeichnung, version: stand }]);
    const client = zeigeMitClient();
    await screen.findByDisplayValue("Teil");
    bezeichnung = "Von Zoe";
    stand = 2;
    await client.invalidateQueries();
    expect(await screen.findByDisplayValue("Von Zoe")).toBeInTheDocument();
  });
});
