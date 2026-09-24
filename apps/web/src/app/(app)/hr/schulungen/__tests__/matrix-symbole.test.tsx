/**
 * Die Schulungsmatrix zeigt den Stand je Zelle als Symbol (Haken/Warn/Kreuz und
 * ein eigenes Symbol für „nie absolviert"), mit sichtbarer Legende. Datum und
 * Detail bleiben als zugängliche Zusatzinfo (aria-label/title) erhalten.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Gesamtmatrix } from "../register-stand";
import type { Person, Schulung, Stand } from "@/lib/schulungen";

const HEUTE = "2026-09-20";

function person(): Person {
  return {
    schluessel: "p:1",
    employee_id: 1,
    extern_id: null,
    personalnummer: "1",
    name: "Anna Muster",
    abteilung: "QS",
    eintritt: null,
    herkunft: "personio",
    standort: null,
  };
}

function schulung(id: string, name: string): Schulung {
  return {
    id,
    bereich: "Sicherheit",
    name,
    turnus: null,
    turnus_monate: 12,
    frist_tage: null,
    verantwortlicher: null,
    beschreibung: null,
    sortierung: 0,
    aktiv: true,
  };
}

function stand(schulung_id: string, felder: Partial<Stand>): Stand {
  return {
    teilnahme_id: `t-${schulung_id}`,
    schulung_id,
    employee_id: 1,
    extern_id: null,
    schluessel: "p:1",
    mitarbeiter_name: "Anna Muster",
    abteilung_kuerzel: "QS",
    bereich: "Sicherheit",
    schulung: schulung_id,
    turnus_monate: 12,
    aktuell_datum: null,
    faellig_am: null,
    ueberfaellig: false,
    nie_absolviert: false,
    ...felder,
  };
}

// Vier aktive Schulungen decken die vier Zustände ab, die fünfte bleibt ohne
// Teilnahme (nicht zugewiesen). Namen so, dass sie in dieser Reihenfolge sortieren.
const KATALOG = [
  schulung("s1", "A aktuell"),
  schulung("s2", "B bald"),
  schulung("s3", "C ueberfaellig"),
  schulung("s4", "D nie"),
  schulung("s5", "E ohne"),
];

const STAND = [
  stand("s1", { aktuell_datum: "2026-01-10", faellig_am: "2027-01-10" }), // im Turnus
  stand("s2", { aktuell_datum: "2025-11-01", faellig_am: "2026-10-15" }), // wird bald fällig
  stand("s3", { aktuell_datum: "2024-05-01", ueberfaellig: true }), // überfällig
  stand("s4", { nie_absolviert: true }), // nie absolviert (zugewiesen, offen)
];

function zeige() {
  render(
    <SprachAnbieter sprache="de">
      <Gesamtmatrix stand={STAND} personen={[person()]} katalog={KATALOG} heute={HEUTE} />
    </SprachAnbieter>,
  );
  // Die Matrix beginnt eingeklappt — aufklappen.
  fireEvent.click(screen.getByRole("button", { name: /Gesamtmatrix|Stand der Mitarbeiter|Matrix/i }));
}

describe("Schulungsmatrix — Statussymbole und Legende", () => {
  it("zeigt eine vollständige Legende mit allen vier Zuständen und „nicht zugewiesen“", () => {
    zeige();
    expect(screen.getByText("Legende:")).toBeInTheDocument();
    for (const label of ["im Turnus", "Wird fällig", "Überfällig", "nie absolviert", "nicht zugewiesen"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("stellt jeden Zustand als Symbol mit zugänglicher Bezeichnung dar, Datum inklusive", () => {
    zeige();
    // Jede Statuszelle ist ein role=img mit sprechender Bezeichnung.
    const aktuell = screen.getByRole("img", { name: /A aktuell: im Turnus, 10\.01\.26/ });
    const bald = screen.getByRole("img", { name: /B bald: Wird fällig/ });
    const ueber = screen.getByRole("img", { name: /C ueberfaellig: Überfällig/ });
    const nie = screen.getByRole("img", { name: /D nie: nie absolviert/ });
    expect(aktuell).toBeInTheDocument();
    expect(bald).toBeInTheDocument();
    // „nie absolviert“ und „überfällig“ tragen verschiedene Bezeichnungen und
    // verschiedene Symbole — nicht mehr nur dieselbe Farbe.
    expect(nie).toBeInTheDocument();
    expect(ueber).toBeInTheDocument();
    expect(nie.getAttribute("aria-label")).not.toEqual(ueber.getAttribute("aria-label"));
    expect(nie.querySelector("svg")?.outerHTML).not.toEqual(ueber.querySelector("svg")?.outerHTML);
  });
});
