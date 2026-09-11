import type { Texte } from "@/texte/de";

/**
 * The English strings. Typed as `Texte`, so a missing or renamed key is a
 * compile error and never an empty box at runtime.
 *
 * Page names in `pfad.seiten` follow the paths, not the German words: a link
 * that says "Training" has to lead to the page the German one calls
 * „Schulungen".
 */
export const en: Texte = {
  kopf: {
    uebersicht: "To the overview",
    hilfe: "Help",
    einstellungen: "Settings",
    abmelden: "Sign out",
    sprache: "Language",
    erscheinungsbild: "Appearance",
    hell: "Light",
    dunkel: "Dark",
    system: "Follow the system",
    meldungenLeer: "Reports — nothing new",
    meldungen: (anzahl: number) => `Reports — ${anzahl} not yet looked at`,
    massnahmenLeer: "Actions — none open",
    massnahmen: (offen: number, ueberfaellig: number) =>
      ueberfaellig > 0
        ? `Actions — ${offen} open, ${ueberfaellig} of them overdue`
        : `Actions — ${offen} open`,
  },
  pfad: {
    aria: "Path",
    start: "Home",
    seiten: {
      "/atr": "ATR",
      "/atr/lieferungen": "Deliveries",
      "/einstellungen": "Settings",
      "/fair": "FAIR",
      "/hilfe": "Help",
      "/hr": "People",
      "/hr/dokumente": "Document run",
      "/hr/einarbeitung": "Induction",
      "/hr/kompetenzen": "Skills",
      "/hr/onboarding": "Onboarding",
      "/hr/organigramm": "Org chart",
      "/hr/schulungen": "Training",
      "/hr/schulungen/matrix": "Matrix",
      "/hr/schulungen/offen": "Outstanding",
      "/hr/zeugnisse": "References",
      "/kpi": "Metrics",
      "/kpi/bewertung": "Review",
      "/kpi/einkauf": "Purchasing",
      "/kpi/finanzen": "Finance",
      "/kpi/produktion": "Production",
      "/kpi/qualitaet": "Quality",
      "/kpi/vertrieb": "Sales",
      "/newsletter": "Newsletter",
      "/newsletter/redaktion": "Editing",
      "/platform/feedback": "Reports",
      "/produktion": "Production",
      "/qualitaet": "Quality",
      "/sensoren": "Sensors",
      "/signage": "Digital signage",
      "/signage/devices": "Devices",
      "/signage/media": "Media",
      "/signage/pair": "Pairing",
      "/signage/playlists": "Playlists",
      "/signage/schedules": "Schedules",
      "/uploads": "Uploads",
    },
  },
  start: {
    titel: "Apps",
    verweigert: (name: string) => `You are not allowed to open “${name}”.`,
    keineApp: "No app has been assigned to your account yet. Please contact platform admin.",
  },
  anmeldung: {
    titel: "ACM Platform",
    aufforderung: "Sign in with your account.",
    email: "E-mail",
    passwort: "Password",
    knopf: "Sign in",
    laeuft: "Signing in …",
  },
  allgemein: {
    laedt: "Loading …",
  },
};
