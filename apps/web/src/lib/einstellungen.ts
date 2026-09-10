/**
 * Was auf der Einstellungsseite steht — als Daten, nicht als Verzweigung im
 * Markup.
 *
 * Einstellungen lagen vorher dort, wo sie fachlich hingehörten: die Zielwerte
 * unter `/einstellungen`, die ATR-Vorlagen im Teilekatalog, der Eingangsordner
 * unter den Lieferungen. Wer etwas einstellen wollte, musste wissen, wo. Jetzt
 * stehen alle an einer Stelle, nach Bereich gruppiert.
 *
 * Die Seite gehört der Plattform-Verwaltung. Was hier steht, gilt für alle:
 * ein Zielwert, eine Vorlage je Programm, ein Eingangsordner — nichts davon
 * hängt daran, wer gerade angemeldet ist.
 */
export interface Gruppe {
  /** Anker in der URL und Schlüssel im Markup. */
  id: string;
  titel: string;
  /** Ein Satz darüber, was die Einstellungen dieser Gruppe bewirken. */
  beschreibung: string;
}

export const GRUPPEN: Gruppe[] = [
  {
    id: "kennzahlen",
    titel: "Kennzahlen",
    beschreibung:
      "Zielwerte der Dashboards. Sie erscheinen als Ziellinie im Verlauf und entscheiden, ab wann eine Kachel warnt.",
  },
  {
    id: "personal",
    titel: "Personal",
    beschreibung:
      "Welche Abwesenheiten als Krankheit zählen und welche Abteilungen zur Produktion gehören. Ohne diese Listen bleiben die Personalquoten leer.",
  },
  {
    id: "atr",
    titel: "ATR",
    beschreibung:
      "Was in jedem Dokument eines Programms gleich steht, und woher die Lieferscheine kommen.",
  },
  {
    id: "zugaenge",
    titel: "Nutzer und Gruppen",
    beschreibung:
      "Personen anlegen, Gruppen bilden und ihnen App-Rechte geben. Änderungen wirken, sobald sich die betroffene Person das nächste Mal anmeldet — die Rechte stehen in ihrem Token.",
  },
];
