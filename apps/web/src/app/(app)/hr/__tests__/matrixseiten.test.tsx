/**
 * Blättern in den Matrizen — und wo es nicht hingehört.
 *
 * Die Gesamtmatrix der Schulungen ist der Nachweis „jede Person gegen jede
 * Pflichtschulung". Mit der üblichen Seitengröße von 25 zeigte sie von 82
 * Personen ein knappes Drittel, und das Fehlende sah aus wie nicht vorhanden.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { useMatrixseiten } from "../matrixseiten";

const LEUTE = Array.from({ length: 82 }, (_, i) => ({ name: `Person ${i + 1}` }));

function Probe({ alleAufEinmal }: { alleAufEinmal: boolean }) {
  const seiten = useMatrixseiten(LEUTE, (p) => p.name, { alleAufEinmal });
  return (
    <div>
      <span data-testid="anzahl">{seiten.fenster.zeilen.length}</span>
      <span data-testid="seiten">{seiten.fenster.seiten}</span>
      <span data-testid="gesamt">{seiten.fenster.gesamt}</span>
    </div>
  );
}

function zeige(alleAufEinmal: boolean) {
  render(
    <SprachAnbieter sprache="de">
      <Probe alleAufEinmal={alleAufEinmal} />
    </SprachAnbieter>,
  );
}

describe("useMatrixseiten", () => {
  it("blättert sonst in Seiten der eingestellten Größe", () => {
    zeige(false);
    expect(screen.getByTestId("anzahl").textContent).toBe("25");
    expect(screen.getByTestId("seiten").textContent).toBe("4");
  });

  it("zeigt mit alleAufEinmal jede Zeile auf einer Seite", () => {
    zeige(true);
    expect(screen.getByTestId("anzahl").textContent).toBe("82");
    expect(screen.getByTestId("seiten").textContent).toBe("1");
    expect(screen.getByTestId("gesamt").textContent).toBe("82");
  });
});
