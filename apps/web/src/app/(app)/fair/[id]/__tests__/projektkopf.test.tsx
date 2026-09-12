/**
 * Projektkopf über der Zeichnung (FAI-03): Beschriftungen wie im Altsystem,
 * Speichern beim Verlassen des Felds oder mit Enter, leer heißt „kein Wert“.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Projektkopf } from "../projektkopf";

const WERTE = { kunde: "Pilatus", artikelnummer: null, teilenummer: "4711-01" };

function zeige(darfSchreiben: boolean) {
  const onSpeichern = vi.fn();
  render(
    <SprachAnbieter sprache="de">
      <Projektkopf werte={WERTE} darfSchreiben={darfSchreiben} onSpeichern={onSpeichern} />
    </SprachAnbieter>,
  );
  return onSpeichern;
}

describe("Projektkopf", () => {
  it("beschriftet Kunde, Artikelnr. und P/N mit den vorhandenen Werten", () => {
    zeige(true);
    expect(screen.getByLabelText("Kunde")).toHaveValue("Pilatus");
    expect(screen.getByLabelText("Artikelnr.")).toHaveValue("");
    expect(screen.getByLabelText("P/N")).toHaveValue("4711-01");
  });

  it("speichert beim Verlassen getrimmt und nur, wenn sich etwas geändert hat", () => {
    const onSpeichern = zeige(true);
    const kunde = screen.getByLabelText("Kunde");
    fireEvent.blur(kunde);
    expect(onSpeichern).not.toHaveBeenCalled();

    fireEvent.change(kunde, { target: { value: "  Pilatus AG " } });
    fireEvent.blur(kunde);
    expect(onSpeichern).toHaveBeenCalledWith("kunde", "Pilatus AG");
  });

  it("leert ein Feld als fehlenden Wert und speichert mit Enter", () => {
    const onSpeichern = zeige(true);
    const pn = screen.getByLabelText("P/N");
    fireEvent.change(pn, { target: { value: "   " } });
    fireEvent.keyDown(pn, { key: "Enter" });
    fireEvent.blur(pn);
    expect(onSpeichern).toHaveBeenCalledTimes(1);
    expect(onSpeichern).toHaveBeenCalledWith("teilenummer", null);
  });

  it("zeigt Lesenden die Werte ohne Eingabefelder", () => {
    zeige(false);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Pilatus")).toBeInTheDocument();
    expect(screen.getByText("4711-01")).toBeInTheDocument();
  });
});
