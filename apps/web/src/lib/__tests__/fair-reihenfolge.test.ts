import { describe, expect, it } from "vitest";

import { mitNeuenNummern, verschobeneReihenfolge } from "@/lib/fair/reihenfolge";

const B = [
  { id: "c", nummer: 3, wert: "30" },
  { id: "a", nummer: 1, wert: "10" },
  { id: "b", nummer: 2, wert: "20" },
  { id: "d", nummer: 4, wert: "40" },
];

describe("Reihenfolge der Prüfliste (FAI-06)", () => {
  it("schickt immer alle Kennungen, in Nummernfolge mit dem gezogenen Ballon am Ziel", () => {
    expect(verschobeneReihenfolge(B, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(verschobeneReihenfolge(B, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("ändert nichts, wenn auf sich selbst oder ins Leere gezogen wird", () => {
    expect(verschobeneReihenfolge(B, "b", "b")).toBeNull();
    expect(verschobeneReihenfolge(B, "b", "x")).toBeNull();
  });

  it("nummeriert für die sofortige Anzeige 1..n, Werte bleiben am Ballon", () => {
    const neu = mitNeuenNummern(B, ["d", "a", "b", "c"]);
    expect(neu.map((b) => [b.id, b.nummer, b.wert])).toEqual([
      ["d", 1, "40"],
      ["a", 2, "10"],
      ["b", 3, "20"],
      ["c", 4, "30"],
    ]);
  });
});
