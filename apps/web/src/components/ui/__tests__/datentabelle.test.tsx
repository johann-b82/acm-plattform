/**
 * Die gemeinsame Tabelle im DOM: Suchschwelle, Sortierung über Seitengrenzen,
 * Seitenwechsel und Rücksprung bei neuer Menge.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";

interface Zeile {
  id: number;
  name: string;
  betrag: number;
}

const SPALTEN: Tabellenspalte<Zeile>[] = [
  { schluessel: "name", titel: "Name", typ: "text", wert: (z) => z.name },
  { schluessel: "betrag", titel: "Betrag", typ: "zahl", wert: (z) => z.betrag, ausrichtung: "end" },
];

function menge(n: number): Zeile[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, betrag: (i * 37) % 101 }));
}

function zeige(zeilen: Zeile[]) {
  const client = new QueryClient();
  const baum = (z: Zeile[]) => (
    <QueryClientProvider client={client}>
      <SprachAnbieter sprache="de">
        <Datentabelle zeilen={z} spalten={SPALTEN} zeilenSchluessel={(x) => x.id} beschriftung="Test" />
      </SprachAnbieter>
    </QueryClientProvider>
  );
  const ergebnis = render(baum(zeilen));
  return { ...ergebnis, neu: (z: Zeile[]) => ergebnis.rerender(baum(z)) };
}

const koerperZeilen = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

describe("Datentabelle", () => {
  it("zeigt bei 25 Datensätzen kein Suchfeld und keine Blätterknöpfe", () => {
    zeige(menge(25));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nächste Seite" })).toBeNull();
    expect(koerperZeilen()).toHaveLength(25);
  });

  it("zeigt ab 26 Datensätzen Suche und eine zweite Seite", () => {
    zeige(menge(26));
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(koerperZeilen()).toHaveLength(1);
    expect(screen.getByText("26–26 von 26")).toBeInTheDocument();
  });

  it("behält das Suchfeld, wenn die Suche nichts mehr findet, und lässt es leeren", () => {
    zeige(menge(30));
    const feld = screen.getByRole("searchbox");
    fireEvent.change(feld, { target: { value: "gibt es nicht" } });
    expect(screen.getByText("Keine Treffer für diese Suche.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Suche leeren" }));
    expect(koerperZeilen()).toHaveLength(25);
  });

  it("sortiert die ganze Menge, nicht nur die sichtbare Seite", () => {
    zeige(menge(60));
    fireEvent.click(screen.getByRole("button", { name: /Betrag/ }));
    // absteigend: der größte Betrag aller 60 steht oben
    const groesster = Math.max(...menge(60).map((z) => z.betrag));
    expect(within(koerperZeilen()[0]).getAllByRole("cell")[1]).toHaveTextContent(String(groesster));
    expect(screen.getByRole("columnheader", { name: /Betrag/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("springt bei neuer Menge auf die erste Seite", () => {
    const { neu } = zeige(menge(80));
    fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(screen.getByText("Seite 3 von 4")).toBeInTheDocument();
    neu(menge(40));
    expect(screen.getByText("Seite 1 von 2")).toBeInTheDocument();
  });
});
