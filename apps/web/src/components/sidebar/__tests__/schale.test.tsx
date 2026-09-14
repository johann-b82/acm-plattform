/**
 * Die Schale mit Seitenleiste: Apps mit Unterseiten, die aktuelle Seite
 * markiert, einklappbar zur Symbolleiste (gemerkt über die Server-Aktion),
 * auf schmalen Bildschirmen als Schublade, unten das Benutzermenü.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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
import { Seitenwerkzeuge } from "@/components/sidebar/werkzeugplatz";
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
  it("führt Start und die Apps, dazu Kopf und Inhalt; die Hilfe steht nur oben rechts", () => {
    zeige();
    for (const name of ["Start", "KPI-Dashboard", "Uploads"]) {
      expect(within(navi()).getByRole("link", { name })).toBeInTheDocument();
    }
    // Die Hilfe steht nur noch oben rechts in der Kopfzeile.
    expect(within(navi()).queryByRole("link", { name: "Hilfe" })).toBeNull();
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Hilfe" })).toBeInTheDocument();
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

describe("Benutzerbereich", () => {
  const folgt = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("stellt „Angemeldet als“ direkt über „Abmelden“, unter die Einstellungen", () => {
    zeige();
    const leiste = within(screen.getByTestId("seitenleiste"));
    const wer = leiste.getByText("anna@example.com");
    const einstellungen = leiste.getByRole("link", { name: "Einstellungen" });
    const abmelden = leiste.getByRole("button", { name: "Abmelden" });
    const sprache = leiste.getByRole("combobox", { name: "Sprache" });
    expect(folgt(sprache, wer)).toBe(true);
    expect(folgt(einstellungen, wer)).toBe(true);
    expect(folgt(wer, abmelden)).toBe(true);
  });

  it("zeigt nur die Adresse, kein Kürzel davor — auch eingeklappt nicht", () => {
    zeige();
    expect(within(screen.getByTestId("seitenleiste")).queryByText("AN")).toBeNull();
    cleanup();
    zeige(true);
    expect(within(screen.getByTestId("seitenleiste")).queryByText("AN")).toBeNull();
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

  it("gliedert die Leiste in feste Kategorien mit Überschrift, in fester Reihenfolge", () => {
    zeige();
    const kategorien = within(werkzeuge())
      .getAllByRole("region")
      .map((r) => r.getAttribute("aria-label"));
    expect(kategorien).toEqual(["Navigation", "Ansicht", "Filter", "Zeitraum", "Aktionen"]);
    for (const name of kategorien) {
      expect(within(werkzeuge()).getByRole("heading", { name: name! })).toBeInTheDocument();
    }
  });

  it("ordnet Umschalter des Seitenkopfs der Ansicht zu, seine Bedienung den Aktionen", async () => {
    zeige(false, {
      inhalt: (
        <Seitenkopf
          links={<button type="button">Umschalter</button>}
          bedienung={<button type="button">Uploads</button>}
        />
      ),
    });
    const ansicht = within(werkzeuge()).getByRole("region", { name: "Ansicht" });
    const aktionen = within(werkzeuge()).getByRole("region", { name: "Aktionen" });
    expect(await within(ansicht).findByRole("button", { name: "Umschalter" })).toBeInTheDocument();
    expect(within(aktionen).getByRole("button", { name: "Uploads" })).toBeInTheDocument();
  });

  it("lässt den Aktionen-Platz leer, wenn die Bedienung selbst in eine andere Kategorie wandert", async () => {
    // Wie die Zeitraumwahl: sie steht in der Bedienung des Seitenkopfs, stellt
    // sich aber unter „Zeitraum“. Unter „Aktionen“ darf keine leere Hülle
    // zurückbleiben, sonst hält die Leiste die Kategorie für belegt.
    zeige(false, {
      inhalt: (
        <Seitenkopf
          bedienung={
            <Seitenwerkzeuge kategorie="zeitraum">
              <select aria-label="Zeitraum" />
            </Seitenwerkzeuge>
          }
        />
      ),
    });
    const zeitraum = within(werkzeuge()).getByRole("region", { name: "Zeitraum" });
    expect(await within(zeitraum).findByRole("combobox", { name: "Zeitraum" })).toBeInTheDocument();
    expect(document.querySelector('[data-platz="aktionen"]')).toBeEmptyDOMElement();
  });

  it("stellt Umschalter ohne eigene Hülle in den Platz, damit sie die volle Breite bekommen", async () => {
    zeige(false, { inhalt: <Seitenkopf links={<button type="button">Umschalter</button>} /> });
    const knopf = await within(werkzeuge()).findByRole("button", { name: "Umschalter" });
    expect(document.querySelector('[data-platz="ansicht"]')!.firstElementChild).toBe(knopf);
  });
});

describe("Inhalt", () => {
  it("begrenzt den Inhalt zwischen den Leisten auf 1600 Pixel", () => {
    zeige();
    expect(screen.getByRole("main").className).toContain("max-w-[100rem]");
  });
});
