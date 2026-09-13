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
  /** Anker in der URL, Schlüssel im Markup und im Wörterbuch: `gruppen[id]`
   *  ist die Überschrift, `gruppen[id + "Text"]` der Satz darunter. */
  id: string;
}

export const GRUPPEN: Gruppe[] = [
  { id: "kennzahlen" },
  { id: "personal" },
  { id: "atr" },
  { id: "qualitaet" },
  { id: "sensoren" },
  { id: "zeugnisse" },
  { id: "erscheinung" },
  { id: "anzeigen" },
  { id: "email" },
  { id: "zugaenge" },
];
