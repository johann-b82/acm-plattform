/**
 * Was auf der Einstellungsseite steht — als Daten, nicht als Verzweigung im
 * Markup.
 *
 * Einstellungen lagen vorher dort, wo sie fachlich hingehörten: die Zielwerte
 * unter `/einstellungen`, die ATR-Vorlagen im Teilekatalog, der Eingangsordner
 * unter den Lieferungen. Wer etwas einstellen wollte, musste wissen, wo. Jetzt
 * stehen alle an einer Stelle, nach Bereich gruppiert.
 *
 * Sichtbar ist eine Gruppe, wenn man das zugehörige App-Recht hat — dasselbe
 * Recht, mit dem die Datenbank die Zeilen herausgibt. Ändern ist eine zweite
 * Frage und steckt in den Abschnitten selbst.
 */
import { hasLevel, type Apps, type Level } from "@/lib/rechte";

export interface Gruppe {
  /** Anker in der URL und Schlüssel im Markup. */
  id: string;
  titel: string;
  /** Ein Satz darüber, was die Einstellungen dieser Gruppe bewirken. */
  beschreibung: string;
  /** App-Recht, mit dem die Datenbank diese Zeilen zum Lesen herausgibt. */
  app: string;
  stufe?: Level;
}

export const GRUPPEN: Gruppe[] = [
  {
    id: "kennzahlen",
    titel: "Kennzahlen",
    beschreibung:
      "Zielwerte der Dashboards. Sie erscheinen als Ziellinie im Verlauf und entscheiden, ab wann eine Kachel warnt.",
    app: "kpi",
  },
  {
    id: "personal",
    titel: "Personal",
    beschreibung:
      "Welche Abwesenheiten als Krankheit zählen und welche Abteilungen zur Produktion gehören. Ohne diese Listen bleiben die Personalquoten leer.",
    app: "kpi",
  },
  {
    id: "atr",
    titel: "ATR",
    beschreibung:
      "Was in jedem Dokument eines Programms gleich steht, und woher die Lieferscheine kommen.",
    app: "atr",
  },
  {
    id: "zugaenge",
    titel: "Nutzer und Gruppen",
    beschreibung:
      "Personen anlegen, Gruppen bilden und ihnen App-Rechte geben. Änderungen wirken, sobald sich die betroffene Person das nächste Mal anmeldet — die Rechte stehen in ihrem Token.",
    app: "platform",
    stufe: "admin",
  },
];

/** Die Gruppen, die diese Person überhaupt zu sehen bekommt. */
export function sichtbareGruppen(apps: Apps): Gruppe[] {
  return GRUPPEN.filter((g) => hasLevel(apps, g.app, g.stufe ?? "viewer"));
}
