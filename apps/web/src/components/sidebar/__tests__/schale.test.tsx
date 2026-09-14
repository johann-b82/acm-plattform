/**
 * Die Schale mit Seitenleiste: Apps mit Unterseiten, die aktuelle Seite
 * markiert, einklappbar zur Symbolleiste (gemerkt über die Server-Aktion),
 * auf schmalen Bildschirmen als Schublade, unten das Benutzermenü.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const pfad = vi.hoisted(() => ({ jetzt: "/kpi/vertrieb" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pfad.jetzt,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const aktion = vi.hoisted(() => ({ setzeSeitenleiste: vi.fn(async () => undefined) }));
vi.mock("@/app/seitenleiste-aktion", () => aktion);
vi.mock("@/app/sprache-aktion", () => ({ setzeSprache: vi.fn() }));
vi.mock("@/app/login/actions", () => ({ signOut: vi.fn() }));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Schale } from "../schale";
import type { NavEintrag } from "@/lib/navigation";

const EINTRAEGE: NavEintrag[] = [
  {
    pfad: "/kpi",
    name: "KPI-Dashboard",
    unterseiten: [
      { pfad: "/kpi/vertrieb", titelVon: "/kpi/vertrieb" },
      { pfad: "/hr/kennzahlen", titelVon: "/hr" },
    ],
  },
  {
    pfad: "/hr",
    name: "HR",
    unterseiten: [{ pfad: "/hr/organigramm", titelVon: "/hr/organigramm" }],
  },
  { pfad: "/uploads", name: "Uploads", unterseiten: [] },
];

function zeige(eingeklappt = false) {
  return render(
    <SprachAnbieter sprache="de">
      <Schale
        eintraege={EINTRAEGE}
        eingeklappt={eingeklappt}
        logo={null}
        appName="ACM-Plattform"
        email="anna@example.com"
        darfEinstellungen
        kopf={<span>Zähler</span>}
      >
        <p>Inhalt</p>
      </Schale>
    </SprachAnbieter>,
  );
}

const navi = () => screen.getByRole("navigation", { name: "Navigation" });

beforeEach(() => {
  vi.clearAllMocks();
  pfad.jetzt = "/kpi/vertrieb";
});

describe("Seitenleiste", () => {
  it("führt Start, die Apps und die Hilfe, dazu Kopf und Inhalt", () => {
    zeige();
    for (const name of ["Start", "KPI-Dashboard", "Uploads", "Hilfe"]) {
      expect(within(navi()).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(navi()).getAllByRole("link", { name: "HR" }).map((l) => l.getAttribute("href"))).toContain("/hr");
    expect(screen.getByText("Zähler")).toBeInTheDocument();
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
  });

  it("markiert die aktuelle Seite und klappt ihre App auf", () => {
    zeige();
    const vertrieb = within(navi()).getByRole("link", { name: "Vertrieb" });
    expect(vertrieb).toHaveAttribute("aria-current", "page");
    // Unter KPI heißen die HR-Kennzahlen „HR“ — neben der App HR selbst.
    expect(within(navi()).getAllByRole("link", { name: "HR" }).map((l) => l.getAttribute("href"))).toEqual([
      "/hr/kennzahlen",
      "/hr",
    ]);
    expect(within(navi()).queryByRole("link", { name: "Organigramm" })).toBeNull();
  });

  it("klappt die Unterseiten einer anderen App auf Wunsch auf", () => {
    zeige();
    fireEvent.click(within(navi()).getByRole("button", { name: "HR: Unterseiten zeigen" }));
    expect(within(navi()).getByRole("link", { name: "Organigramm" })).toHaveAttribute("href", "/hr/organigramm");
    expect(within(navi()).getByRole("button", { name: "HR: Unterseiten verbergen" })).toBeInTheDocument();
  });

  it("klappt zur Symbolleiste ein und merkt sich das", () => {
    zeige();
    fireEvent.click(screen.getByRole("button", { name: "Seitenleiste einklappen" }));
    expect(aktion.setzeSeitenleiste).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Seitenleiste ausklappen" })).toBeInTheDocument();
    // Eingeklappt: keine Unterseiten, die Apps bleiben über ihr Zeichen erreichbar.
    expect(within(navi()).queryByRole("link", { name: "Vertrieb" })).toBeNull();
    expect(within(navi()).getByRole("link", { name: "KPI-Dashboard" })).toHaveAttribute("href", "/kpi");
  });

  it("startet eingeklappt, wenn es so gemerkt ist", () => {
    zeige(true);
    expect(screen.getByRole("button", { name: "Seitenleiste ausklappen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Seitenleiste ausklappen" }));
    expect(aktion.setzeSeitenleiste).toHaveBeenCalledWith(false);
  });

  it("öffnet und schließt die Schublade auf schmalen Bildschirmen", () => {
    zeige();
    const leiste = screen.getByTestId("seitenleiste");
    expect(leiste).toHaveAttribute("data-offen", "false");
    fireEvent.click(screen.getByRole("button", { name: "Navigation öffnen" }));
    expect(leiste).toHaveAttribute("data-offen", "true");
    fireEvent.click(screen.getByRole("button", { name: "Navigation schließen" }));
    expect(leiste).toHaveAttribute("data-offen", "false");
  });

  it("stellt das Logo links in die Kopfzeile, den Pfad rechts daneben", () => {
    zeige();
    const kopfzeile = screen.getByRole("banner");
    const logo = within(kopfzeile).getByRole("link", { name: "Zur Übersicht" });
    const pfadNavi = within(kopfzeile).getByRole("navigation", { name: "Pfad" });
    expect(logo.compareDocumentPosition(pfadNavi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByTestId("seitenleiste")).queryByRole("link", { name: "Zur Übersicht" })).toBeNull();
  });

  it("trägt das Benutzermenü in der Seitenleiste", () => {
    zeige();
    const leiste = screen.getByTestId("seitenleiste");
    expect(within(leiste).getByRole("button", { name: "Benutzermenü" })).toBeInTheDocument();
  });
});
