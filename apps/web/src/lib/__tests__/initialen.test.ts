/**
 * Zwei Initialen für das Benutzermenü (NAV-02).
 *
 * Das Token trägt nur die Adresse, keinen Namen. Die Initialen kommen deshalb
 * aus dem Teil vor dem @: bei „vorname.nachname“ die Anfänge beider Teile,
 * sonst die ersten zwei Buchstaben.
 */
import { describe, expect, it } from "vitest";

import { initialen } from "@/lib/initialen";

describe("initialen", () => {
  it("nimmt bei zweiteiligem Namen beide Anfangsbuchstaben", () => {
    expect(initialen("max.mustermann@acm-aerospace.com")).toBe("MM");
    expect(initialen("anna-lena_berg@acm.local")).toBe("AB");
  });

  it("nimmt bei einteiligem Namen die ersten zwei Buchstaben", () => {
    expect(initialen("bechtold@acm-aerospace.com")).toBe("BE");
    expect(initialen("admin@acm.local")).toBe("AD");
  });

  it("kommt mit Umlauten, Ziffern und einem Buchstaben zurecht", () => {
    expect(initialen("özlem.ünal@x.de")).toBe("ÖÜ");
    expect(initialen("2te.person@x.de")).toBe("TP");
    expect(initialen("x@acm.local")).toBe("X");
  });

  it("zeigt ohne Adresse ein Fragezeichen", () => {
    expect(initialen(null)).toBe("?");
    expect(initialen("")).toBe("?");
  });
});
