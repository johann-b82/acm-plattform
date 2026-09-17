/**
 * Die Adresse, unter der der Browser Supabase erreicht, kommt aus der Anfrage.
 *
 * Mit `http://localhost/supabase` in der Einstellung erreichte die Plattform
 * von jedem anderen Rechner aus keine Daten mehr: `localhost` zeigt dort auf
 * den Rechner davor.
 */
import { describe, expect, it } from "vitest";

import { oeffentlicheAdresse } from "@/lib/supabase/oeffentlich";

const KONFIG = "http://localhost/supabase";

describe("oeffentlicheAdresse", () => {
  it("nimmt den Host der Anfrage und behält den Pfad", () => {
    expect(oeffentlicheAdresse(KONFIG, "192.9.201.9", "http")).toBe(
      "http://192.9.201.9/supabase",
    );
  });

  it("behält Port und Protokoll des Aufrufs", () => {
    expect(oeffentlicheAdresse(KONFIG, "acm.acm.local:8081", "https")).toBe(
      "https://acm.acm.local:8081/supabase",
    );
  });

  it("nimmt bei mehreren Sprüngen den ersten Eintrag", () => {
    expect(oeffentlicheAdresse(KONFIG, "acm.local", "https,http")).toBe(
      "https://acm.local/supabase",
    );
  });

  it("ohne Protokollkopf gilt http — im Werk läuft es ohne TLS", () => {
    expect(oeffentlicheAdresse(KONFIG, "acm.local", null)).toBe("http://acm.local/supabase");
  });

  it("ohne Host bleibt die Einstellung", () => {
    expect(oeffentlicheAdresse(KONFIG, null, "http")).toBe(KONFIG);
  });

  it("eine Einstellung ohne Pfad bleibt ohne Pfad", () => {
    expect(oeffentlicheAdresse("http://localhost:8000", "acm.local", "http")).toBe(
      "http://acm.local",
    );
  });

  it("ein Schrägstrich am Ende zählt nicht als Pfad", () => {
    expect(oeffentlicheAdresse("http://localhost/supabase/", "acm.local", "http")).toBe(
      "http://acm.local/supabase",
    );
  });

  it("was keine Adresse ist, bleibt unangetastet", () => {
    expect(oeffentlicheAdresse("/supabase", "acm.local", "http")).toBe("/supabase");
  });

  it("ohne Einstellung bleibt es leer", () => {
    expect(oeffentlicheAdresse(undefined, "acm.local", "http")).toBe("");
  });
});
