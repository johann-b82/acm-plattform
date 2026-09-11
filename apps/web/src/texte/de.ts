import { TITEL, type Pfadtitel } from "@/lib/brotkrumen";

/**
 * Die deutschen Texte der Oberfläche. Diese Datei ist die Vorlage: ihr Typ
 * bestimmt, was jede andere Sprache liefern muss — eine fehlende Übersetzung
 * ist ein Übersetzungsfehler und kein leerer Kasten zur Laufzeit.
 *
 * Es stehen hier nur Texte der **Schale**: Kopfzeile, Pfad, Startbildschirm,
 * Anmeldung. Die Fachseiten kommen bereichsweise dazu. Ein halbes Wörterbuch
 * ist besser als ein ganzes, das zur Hälfte maschinell geraten ist.
 */
export const de = {
  kopf: {
    uebersicht: "Zur Übersicht",
    hilfe: "Hilfe",
    einstellungen: "Einstellungen",
    abmelden: "Abmelden",
    sprache: "Sprache",
    erscheinungsbild: "Erscheinungsbild",
    hell: "Hell",
    dunkel: "Dunkel",
    system: "Wie das System",
    meldungenLeer: "Meldungen — nichts Neues",
    meldungen: (anzahl: number) => `Meldungen — ${anzahl} noch nicht angesehen`,
    massnahmenLeer: "Maßnahmen — keine offen",
    massnahmen: (offen: number, ueberfaellig: number) =>
      ueberfaellig > 0
        ? `Maßnahmen — ${offen} offen, davon ${ueberfaellig} überfällig`
        : `Maßnahmen — ${offen} offen`,
  },
  pfad: {
    aria: "Pfad",
    start: "Start",
    seiten: TITEL as Pfadtitel,
  },
  start: {
    titel: "Apps",
    verweigert: (name: string) => `Für „${name}“ hast du keine Berechtigung.`,
    keineApp:
      "Deinem Konto ist noch keine App zugewiesen. Bitte an die Plattform-Verwaltung wenden.",
  },
  anmeldung: {
    titel: "ACM-Plattform",
    aufforderung: "Mit deinem Konto anmelden.",
    email: "E-Mail",
    passwort: "Passwort",
    knopf: "Anmelden",
    laeuft: "Anmelden …",
  },
  allgemein: {
    laedt: "Wird geladen …",
  },
};

export type Texte = typeof de;
