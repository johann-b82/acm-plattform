/**
 * Die Ablageziele von „Auf Server speichern“ in der Maske des Eingangsordners:
 * sichtbar, änderbar, und ein Ziel wird nie still geleert.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { einstellung, aendern, passwortStand } = vi.hoisted(() => ({
  einstellung: vi.fn(),
  aendern: vi.fn(),
  passwortStand: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/atr", async (original) => {
  const echt = await original<typeof import("@/lib/atr")>();
  return {
    ...echt,
    scanApi: { ...echt.scanApi, einstellung, aendern, passwortStand },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Eingangsordner } from "../abschnitte/atr-eingangsordner";

const MAPPE_A380 =
  "1300 - Qualität\\1320_QS\\132002_WA-Prüfung\\132002_02_TR_Spec_QAA\\DIEHL\\A380" +
  "\\ATR_Acceptance Test Report\\ACM_ATR_A 380_.....{jahr}";

const EINSTELLUNG = {
  intervall_s: 0,
  modus: "entwurf",
  rechner: "acm_file",
  freigabe: "Dateiablage",
  domaene: null,
  benutzer: "dienst",
  eingang: "ATR/Input",
  ausgang: "ATR/Output",
  archiv: "ATR/Archiv",
  ziel_mappe_a350: "QS\\A350\\{jahr}",
  ziel_mappe_a380: MAPPE_A380,
  ziel_logistik: "1200 - Logistik\\Versand\\ATR`S_Weight Reports_Firma Diehl_Portal",
  ziel_weight_report: "QS\\WR\\{jahr}\\KW {kw}",
  zuletzt_am: null,
  zuletzt_text: null,
};

function zeige() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SprachAnbieter sprache="de">
        <Eingangsordner />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  einstellung.mockResolvedValue(EINSTELLUNG);
  passwortStand.mockResolvedValue({
    gesetzt: true,
    quelle: "datenbank",
    geaendert_am: null,
    schluessel_bereit: true,
  });
  aendern.mockResolvedValue(undefined);
});

describe("Ablageziele", () => {
  it("zeigt die vier Ziele mit den gespeicherten Pfaden", async () => {
    zeige();
    expect(await screen.findByLabelText("Mappe A380")).toHaveValue(MAPPE_A380);
    expect(screen.getByLabelText("Mappe A350")).toHaveValue("QS\\A350\\{jahr}");
    expect(screen.getByLabelText("PDF Logistik")).toHaveValue(EINSTELLUNG.ziel_logistik);
    expect(screen.getByLabelText("PDF Weight Report")).toHaveValue("QS\\WR\\{jahr}\\KW {kw}");
  });

  it("speichert nur das geänderte Ziel", async () => {
    zeige();
    fireEvent.change(await screen.findByLabelText("PDF Logistik"), {
      target: { value: "  Logistik\\Neu  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(aendern).toHaveBeenCalledWith({ ziel_logistik: "Logistik\\Neu" }),
    );
  });

  it("übersetzt die Abweisung der Datenbank in einen lesbaren Satz", async () => {
    aendern.mockRejectedValue(
      new Error(
        'new row for relation "atr_scan" violates check constraint "atr_scan_ziel_logistik_gueltig"',
      ),
    );
    zeige();
    fireEvent.change(await screen.findByLabelText("PDF Logistik"), {
      target: { value: "A\\..\\B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Zielordner ist ungültig/);
  });
});
