/**
 * Brotkrumenpfad: wo stehe ich, und wie komme ich eine Ebene zurück.
 *
 * Der Pfad in der Adresszeile ist die Gliederung — `/hr/schulungen/matrix`
 * hängt unter `/hr/schulungen` hängt unter `/hr`. Deshalb steht hier nur, wie
 * eine Seite heißt, und nicht noch einmal, wo sie hängt: die Kette entsteht
 * aus den Vorsilben der Adresse. Im Altsystem stand jede Kette ausgeschrieben
 * in einer Tabelle, und mehrere Seiten fehlten darin.
 *
 * Ein Abschnitt ohne Eintrag fällt aus der Kette. Das erledigt die
 * Detailseiten: `/hr/schulungen/7` endet bei „Schulungen“, denn die 7 ist
 * keine Überschrift, und was dahintersteckt wüsste erst der Server.
 */

export type Krume = { titel: string; adresse: string };

/** Wie eine Seite in der Kette heißt. Kurz — die Kette nennt den Rest. */
export const TITEL = {
  "/atr": "ATR",
  "/atr/lieferungen": "Lieferungen",
  "/einstellungen": "Einstellungen",
  "/fair": "FAIR",
  "/hilfe": "Hilfe",
  "/hr": "Personal",
  "/hr/dokumente": "Dokumentenlauf",
  "/hr/einarbeitung": "Einarbeitung",
  "/hr/kompetenzen": "Kompetenzen",
  "/hr/onboarding": "Onboarding",
  "/hr/organigramm": "Organigramm",
  "/hr/schulungen": "Schulungen",
  "/hr/schulungen/matrix": "Matrix",
  "/hr/schulungen/offen": "Offene",
  "/hr/zeugnisse": "Zeugnisse",
  "/kpi": "Kennzahlen",
  "/kpi/bewertung": "Bewertung",
  "/kpi/einkauf": "Einkauf",
  "/kpi/finanzen": "Finanzen",
  "/kpi/produktion": "Produktion",
  "/kpi/qualitaet": "Qualität",
  "/kpi/vertrieb": "Vertrieb",
  "/newsletter": "Newsletter",
  "/newsletter/redaktion": "Redaktion",
  "/platform/feedback": "Meldungen",
  "/produktion": "Produktion",
  "/qualitaet": "Qualität",
  "/sensoren": "Sensoren",
  "/signage": "Digital Signage",
  "/signage/devices": "Geräte",
  "/signage/media": "Medien",
  "/signage/pair": "Koppeln",
  "/signage/playlists": "Wiedergabelisten",
  "/signage/schedules": "Zeitpläne",
  "/uploads": "Uploads",
} satisfies Record<string, string>;

/** Die Adressen, die einen Titel haben — jede Sprache muss sie alle nennen. */
export type Pfadtitel = Record<keyof typeof TITEL, string>;

/**
 * Seiten, die woanders hängen, als ihre Adresse sagt. Nur für den Fall, dass
 * eine Adresse aus gutem Grund bleibt, wo sie ist: `/platform` leitet seit dem
 * Umzug der Verwaltung auf die Einstellungen um, und von dort wird auch auf
 * die Meldungen verwiesen.
 */
export const ELTERN: Record<string, string> = {
  "/platform/feedback": "/einstellungen",
};

/**
 * Die Kette zur aktuellen Adresse, „Start“ vorneweg. Leer auf der Übersicht
 * selbst und auf allem, was hier nicht steht — eine Krume „Start“ allein sagt
 * nichts, was das Logo daneben nicht schon sagt.
 */
export function krumen(
  pfad: string,
  titel: Record<string, string> = TITEL,
  start = "Start",
): Krume[] {
  const ziel = tiefsteBekannte(pfad);
  if (!ziel) return [];
  const kette: string[] = [];
  for (let p: string | undefined = ziel; p; p = eltern(p)) {
    if (kette.includes(p)) break; // ein Kreis in ELTERN hängt sonst den Browser auf
    kette.unshift(p);
  }
  return [
    { titel: start, adresse: "/" },
    ...kette.map((p) => ({ titel: titel[p] ?? BEKANNT[p], adresse: p })),
  ];
}

/** Dieselbe Tafel, nur ohne feste Schlüssel: zum Nachschlagen mit einer
 *  beliebigen Adresse. Welche Adressen es gibt, steht in `TITEL`; wie sie
 *  heißen, kommt je nach Sprache von außen. */
const BEKANNT: Record<string, string> = TITEL;

/** Die längste Vorsilbe der Adresse, die einen Titel hat. */
function tiefsteBekannte(pfad: string): string | undefined {
  const teile = pfad.split("/").filter(Boolean);
  for (let i = teile.length; i > 0; i -= 1) {
    const p = `/${teile.slice(0, i).join("/")}`;
    if (p in BEKANNT) return p;
  }
  return undefined;
}

function eltern(pfad: string): string | undefined {
  if (pfad in ELTERN) return ELTERN[pfad];
  const schnitt = pfad.lastIndexOf("/");
  return schnitt > 0 ? tiefsteBekannte(pfad.slice(0, schnitt)) : undefined;
}
