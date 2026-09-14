import { describe, expect, it } from "vitest";

import { navigation, type AppZeile } from "@/lib/navigation";

const APPS: AppZeile[] = [
  { id: "platform", name: "Plattform-Verwaltung", path: "/platform", sort: 0 },
  { id: "kpi", name: "KPI-Dashboard", path: "/kpi", sort: 10 },
  { id: "newsletter", name: "Newsletter", path: "/newsletter", sort: 20 },
  { id: "hr", name: "HR", path: "/hr", sort: 30 },
  { id: "atr", name: "ATR", path: "/atr", sort: 70 },
  { id: "uploads", name: "Uploads", path: "/uploads", sort: 90 },
  { id: "settings", name: "Einstellungen", path: "/einstellungen", sort: 100 },
];

const pfade = (n: ReturnType<typeof navigation>) => n.map((e) => e.pfad);

describe("Navigation", () => {
  it("zeigt nur Apps mit Recht, in der Reihenfolge der Tabelle, ohne Querschnitt", () => {
    const n = navigation(APPS, { hr: "viewer", kpi: "viewer" });
    expect(pfade(n)).toEqual(["/kpi", "/hr"]);
    expect(n[0].name).toBe("KPI-Dashboard");
  });

  it("Plattform-Verwaltung sieht alle Apps, aber Plattform und Einstellungen nicht als App", () => {
    const n = navigation(APPS, { platform: "admin" });
    expect(pfade(n)).toEqual(["/kpi", "/newsletter", "/hr", "/atr", "/uploads"]);
  });

  it("hängt die Unterseiten der Übersicht an", () => {
    const kpi = navigation(APPS, { kpi: "viewer", hr: "viewer" })[0];
    expect(kpi.unterseiten.map((u) => u.pfad)).toEqual([
      "/kpi/vertrieb",
      "/hr/kennzahlen",
      "/kpi/qualitaet",
      "/kpi/finanzen",
      "/kpi/einkauf",
      "/kpi/produktion",
      "/kpi/bewertung",
    ]);
  });

  it("zeigt eine Unterseite nur mit ihrem eigenen Recht", () => {
    // Die HR-Kennzahlen hängen unter KPI, verlangen aber `hr`.
    const kpi = navigation(APPS, { kpi: "viewer" })[0];
    expect(kpi.unterseiten.map((u) => u.pfad)).not.toContain("/hr/kennzahlen");
    // Zeugnisse verlangen `hr: editor`, die Redaktion `newsletter: editor`.
    const lesend = navigation(APPS, { hr: "viewer", newsletter: "viewer" });
    expect(lesend.find((e) => e.pfad === "/hr")!.unterseiten.map((u) => u.pfad)).not.toContain("/hr/zeugnisse");
    expect(lesend.find((e) => e.pfad === "/newsletter")!.unterseiten).toEqual([]);
    const schreibend = navigation(APPS, { hr: "editor", newsletter: "editor" });
    expect(schreibend.find((e) => e.pfad === "/hr")!.unterseiten.map((u) => u.pfad)).toContain("/hr/zeugnisse");
    expect(schreibend.find((e) => e.pfad === "/newsletter")!.unterseiten.map((u) => u.pfad)).toEqual([
      "/newsletter/redaktion",
    ]);
  });

  it("nennt die HR-Kennzahlen unter KPI wie die Kachel dort „HR“, unter HR „Kennzahlen“", () => {
    const n = navigation(APPS, { kpi: "viewer", hr: "viewer" });
    const unterKpi = n.find((e) => e.pfad === "/kpi")!.unterseiten.find((u) => u.pfad === "/hr/kennzahlen")!;
    const unterHr = n.find((e) => e.pfad === "/hr")!.unterseiten.find((u) => u.pfad === "/hr/kennzahlen")!;
    expect(unterKpi.titelVon).toBe("/hr");
    expect(unterHr.titelVon).toBe("/hr/kennzahlen");
  });

  it("Apps ohne Unterseiten haben eine leere Liste", () => {
    const uploads = navigation(APPS, { uploads: "admin" })[0];
    expect(uploads.pfad).toBe("/uploads");
    expect(uploads.unterseiten).toEqual([]);
  });
});
