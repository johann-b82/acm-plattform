import { describe, expect, it } from "vitest";

import { quartalVon } from "@/lib/newsletter";

describe("Quartal der neuen Ausgabe", () => {
  it("ordnet die Monatsgrenzen dem richtigen Quartal zu", () => {
    expect(quartalVon(new Date(2026, 0, 1))).toBe(1);
    expect(quartalVon(new Date(2026, 2, 31))).toBe(1);
    expect(quartalVon(new Date(2026, 3, 1))).toBe(2);
    expect(quartalVon(new Date(2026, 8, 30))).toBe(3);
    expect(quartalVon(new Date(2026, 9, 1))).toBe(4);
    expect(quartalVon(new Date(2026, 11, 31))).toBe(4);
  });
});
