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
const werkzeugAktion = vi.hoisted(() => ({ setzeWerkzeugleiste: vi.fn(async () => undefined) }));
vi.mock("@/app/werkzeugleiste-aktion", () => werkzeugAktion);
vi.mock("@/app/sprache-aktion", () => ({ setzeSprache: vi.fn() }));
vi.mock("@/app/login/actions", () => ({ signOut: vi.fn() }));

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";
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

function zeige(
  eingeklappt = false,
  { werkzeugeEingeklappt = false, inhalt = <p>Inhalt</p> }: { werkzeugeEingeklappt?: boolean; inhalt?: ReactNode } = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SprachAnbieter sprache="de">
        <Schale
          eintraege={EINTRAEGE}
          eingeklappt={eingeklappt}
          werkzeugeEingeklappt={werkzeugeEingeklappt}
          logo={null}
          appName="ACM-Plattform"
          email="anna@example.com"
          darfEinstellungen
          kopf={<span>Zähler</span>}
        >
          {inhalt}
        </Schale>
      </SprachAnbieter>
    </QueryClientProvider>,
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

  it("stellt die Hilfe oben rechts hinter die Zähler", () => {
    zeige();
    const kopfzeile = screen.getByRole("banner");
    const hilfe = within(kopfzeile).getByRole("link", { name: "Hilfe" });
    expect(hilfe).toHaveAttribute("href", "/hilfe");
    const zaehler = within(kopfzeile).getByText("Zähler");
    expect(zaehler.compareDocumentPosition(hilfe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("zeigt die Einträge des Benutzermenüs direkt in der Seitenleiste", () => {
    zeige();
    const leiste = screen.getByTestId("seitenleiste");
    // Kein Menü hinter den Initialen mehr: alles steht offen da.
    expect(within(leiste).queryByRole("button", { name: "Benutzermenü" })).toBeNull();
    expect(within(leiste).getByText("anna@example.com")).toBeInTheDocument();
    expect(within(leiste).getByRole("combobox", { name: "Sprache" })).toBeInTheDocument();
    expect(within(leiste).getByText("Erscheinungsbild")).toBeInTheDocument();
    expect(within(leiste).getByRole("link", { name: "Einstellungen" })).toHaveAttribute("href", "/einstellungen");
    expect(within(leiste).getByRole("button", { name: "Abmelden" })).toBeInTheDocument();
  });

  it("behält eingeklappt Einstellungen und Abmelden als Zeichen", () => {
    zeige(true);
    const leiste = screen.getByTestId("seitenleiste");
    expect(within(leiste).getByRole("link", { name: "Einstellungen" })).toBeInTheDocument();
    expect(within(leiste).getByRole("button", { name: "Abmelden" })).toBeInTheDocument();
    expect(within(leiste).queryByRole("combobox", { name: "Sprache" })).toBeNull();
  });
});

describe("Rechte Leiste", () => {
  const werkzeuge = () => screen.getByTestId("werkzeugleiste");

  it("stellt Umschalter und Bedienung der Seite in die rechte Leiste, den Satz nicht", async () => {
    zeige(false, {
      inhalt: (
        <Seitenkopf
          untertitel="Satz über der Seite"
          links={<button type="button">Umschalter</button>}
          bedienung={<button type="button">Zeitraum</button>}
        />
      ),
    });
    expect(await within(werkzeuge()).findByRole("button", { name: "Umschalter" })).toBeInTheDocument();
    expect(within(werkzeuge()).getByRole("button", { name: "Zeitraum" })).toBeInTheDocument();
    expect(within(werkzeuge()).queryByText("Satz über der Seite")).toBeNull();
    expect(screen.getByRole("main")).toHaveTextContent("Satz über der Seite");
  });

  it("trägt App Feedback melden, auch auf Seiten ohne Filter", () => {
    zeige();
    expect(within(werkzeuge()).getByRole("button", { name: "App Feedback melden" })).toBeInTheDocument();
  });

  it("klappt ein und merkt sich das; App Feedback bleibt erreichbar", () => {
    zeige();
    fireEvent.click(screen.getByRole("button", { name: "Filterleiste einklappen" }));
    expect(werkzeugAktion.setzeWerkzeugleiste).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Filterleiste ausklappen" })).toBeInTheDocument();
    expect(within(werkzeuge()).getByRole("button", { name: "App Feedback melden" })).toBeInTheDocument();
  });

  it("startet eingeklappt, wenn es so gemerkt ist", () => {
    zeige(false, { werkzeugeEingeklappt: true });
    fireEvent.click(screen.getByRole("button", { name: "Filterleiste ausklappen" }));
    expect(werkzeugAktion.setzeWerkzeugleiste).toHaveBeenCalledWith(false);
  });

  it("öffnet und schließt die Filter auf schmalen Bildschirmen", () => {
    zeige();
    expect(werkzeuge()).toHaveAttribute("data-offen", "false");
    fireEvent.click(screen.getByRole("button", { name: "Filter öffnen" }));
    expect(werkzeuge()).toHaveAttribute("data-offen", "true");
    fireEvent.click(screen.getByRole("button", { name: "Filter schließen" }));
    expect(werkzeuge()).toHaveAttribute("data-offen", "false");
  });
});
