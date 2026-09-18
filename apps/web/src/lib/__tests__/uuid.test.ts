/**
 * UUID ohne secure context.
 *
 * `crypto.randomUUID` gibt es nur über HTTPS oder auf localhost. Wer die
 * Plattform über http://<LAN-IP> aufruft, bekommt ein Crypto-Objekt ohne
 * diese Funktion — der Speicherpfad muss trotzdem entstehen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { uuid } from "@/lib/uuid";

const MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uuid", () => {
  it("nimmt randomUUID, wenn der Browser es anbietet", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: globalThis.crypto.getRandomValues });
    expect(uuid()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("baut ohne randomUUID eine gültige Version-4-UUID aus getRandomValues", () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const wert = uuid();
    expect(wert).toMatch(MUSTER);
    expect(uuid()).not.toBe(wert);
  });

  it("setzt Version und Variante auch bei lauter Nullbytes richtig", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (feld: Uint8Array) => feld.fill(0),
    });
    expect(uuid()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
