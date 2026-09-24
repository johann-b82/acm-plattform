import type { Gruppe } from "./registry";

export const ARBEITEN: Gruppe = {
  id: "arbeiten",
  titel: "Arbeiten mit der Plattform",
  beschreibung: "Daten einlesen, Personal pflegen, Papiere erzeugen.",
  seiten: [
    {
      slug: "daten-hochladen",
      titel: "Daten hochladen",
      kurz: "Welche Datei wohin gehört und was beim Einlesen passiert.",
      text: `
# Daten hochladen

Unter **Uploads**. Nötig ist das Recht *Bearbeiten* auf der jeweiligen
Anwendung.

## Eine Route je Datei

Es gibt nicht einen Knopf für alles, sondern eine Stelle je ERP-Auszug:
Aufträge, Auftragspositionen, Angebote, Interessenten, Kontakte, Umsatz,
Lieferscheine, Liefertreue, Wareneingänge, Lagerbewegungen, Lagerpreise,
Prüfungen, 8D-Berichte.

Der Grund ist Lesbarkeit im Fehlerfall: eine Sammelroute müsste raten, welche
Datei sie vor sich hat, und bei einer unerwarteten Spalte eine Vermutung
melden. So sagt die Meldung, welche Spalte in welcher Datei fehlt.

## Was beim Einlesen passiert

1. Die Datei wird gelesen — CSV, Text oder Excel, je nach Auszug.
2. Die Spalten werden geprüft. Fehlt eine erwartete, bricht der Lauf **vor**
   dem Schreiben ab und nennt sie.
3. Die Zeilen werden geschrieben. Vorhandene Zeilen mit demselben Schlüssel
   werden ersetzt, nicht verdoppelt.
4. Der Lauf wird vermerkt: wann, von wem, wie viele Zeilen.

**Ein Upload ergänzt, er ersetzt nicht den Bestand.** Wer den Auszug eines
Monats einliest, verliert die Vormonate nicht.

## Größe

Eine Datei darf bis 60 MB groß sein. Darüber lehnt die Plattform ab — und zwar
beim Lesen, nicht danach: eine 900-MB-Datei soll nicht erst vollständig im
Speicher landen, um dann verworfen zu werden.

## Wenn etwas schiefgeht

Die Meldung nennt die Ursache im Klartext. Die drei häufigsten:

* **Spalte fehlt** — die Datei stammt aus einem anderen Auszug oder einer
  älteren ERP-Fassung.
* **Datei ist leer** — beim Export ist etwas schiefgegangen.
* **Falsches Format** — eine \`.xls\` statt \`.xlsx\`, oder eine HTML-Datei, die das
  ERP „Excel" nennt.
`.trim(),
    },
    {
      slug: "schulungen",
      titel: "Schulungen",
      kurz: "Katalog, Anforderungsmatrix, was offen ist und die Matrix fürs Audit.",
      text: `
# Schulungen

Unter **HR → Schulungen**. Drei Ansichten auf dieselben Daten.

## Der Katalog

Welche Schulungen es gibt, mit Turnus, Frist und Verantwortlichem. Der
**Turnus** steht im Originaltext der Übersicht („alle 2 Jahre (und bei
Bedarf)") und zusätzlich als Zahl in Monaten, soweit sich eine ableiten ließ.

Wo sich nichts ableiten lässt — „bei Bedarf", „alle 3 - 5 Jahre" — bleibt die
Zahl leer, und für diese Schulung wird keine Fälligkeit gerechnet. **Geraten
wird nicht.**

## Die Anforderungsmatrix

Welche Schulung für welche Abteilung Pflicht ist, auf zwei Ebenen:

* die **feinen Kürzel** aus der Excel (NÄH, CUT, WVK …),
* die **groben Abteilungen** aus Personio.

Beide gelten nebeneinander, weil beide Wertelisten aus fremden Systemen kommen
und sich nicht ineinander überführen lassen.

## „Was offen ist"

Die Handlungsliste, nach Dringlichkeit sortiert:

| Stufe | Bedeutung |
|---|---|
| nie absolviert | für diese Person steht kein Termin in der Historie |
| überfällig | die Fälligkeit liegt in der Vergangenheit |
| wird fällig | innerhalb der nächsten zwei Monate |

„Nie absolviert" wiegt schwerer als „überfällig" — das eine ist eine Lücke, das
andere eine Verspätung.

## Die Matrix

Alle Personen gegen alle Schulungen. Sie beantwortet die andere Frage: **steht
für jede Person und jede Pflichtschulung ein Datum?** Dafür erscheint auch, wer
noch gar keine Teilnahme hat — genau das ist die Lücke, die ein Audit sucht.

Die Kopfspalte bleibt beim Rollen stehen. Jede Zelle trägt ein **Symbol**, dazu
eine Legende über der Matrix:

* **✓ im Turnus** — aktuell, alles in Ordnung.
* **⚠ wird fällig** — läuft demnächst ab.
* **✗ überfällig** — die Frist ist vorbei.
* **○ nie absolviert** — zugewiesen, aber noch nie gemacht.
* **·** — nicht zugewiesen; die Schulung ist für diese Person keine Pflicht.

„Nie absolviert" und „überfällig" sind zweierlei — darum verschiedene Symbole,
nicht nur dieselbe Farbe. Das Datum und die genaue Fälligkeit stehen im Tooltip
der Zelle.

![Die Schulungsmatrix mit Legende und Statussymbolen je Zelle.](/hilfe/schulungsmatrix-legende.png)

## Import der Übersicht

Die Excel-Schulungsübersicht lässt sich einlesen. Der Import **ergänzt** und
verwirft keine Zeile: lässt sich eine Personalnummer niemandem in Personio
zuordnen, bleibt die Zeile mit Nummer und Namen erhalten und erscheint in der
Matrix als eigene Person. Sonst verschwände Historie, weil eine Nummer nicht
gepflegt ist.
`.trim(),
    },
    {
      slug: "kompetenzen",
      titel: "Kompetenzen",
      kurz: "Die Qualifikationsmatrix je Bereich einlesen und lesen.",
      text: `
# Kompetenzen

Unter **HR → Kompetenzen**.

## Was drinsteht

Je Bereich eine Matrix: Personen gegen Qualifikationen, je Zelle eine Stufe.
Die Bereichsdatei wird eingelesen; vor dem Übernehmen zeigt eine **Vorschau**,
was erkannt wurde — Kategorien, Qualifikationen, Personen, Bewertungen.

Erst nach Ansehen der Vorschau wird übernommen. Eine Datei mit verrutschter
Kopfzeile fällt so auf, bevor sie im Bestand steht.

## Die Ansicht

Die Kopfspalte mit den Namen bleibt beim Rollen stehen. Lücken sind in
Warnfarbe. Der Zeilendurchschnitt wird **beim Lesen gerechnet**, nicht aus der
Excel übernommen: ändert sich eine Bewertung, stimmt der Schnitt sofort.
`.trim(),
    },
    {
      slug: "onboarding",
      titel: "Onboarding und Einarbeitung",
      kurz: "Eintritte, der abgeleitete Schulungsplan und die Papiere zur Übergabe.",
      text: `
# Onboarding und Einarbeitung

Unter **HR → Onboarding** und **HR → Einarbeitung**.

## Die Eintrittsliste

Wer neu ist — aus Personio, dazu extern gepflegte Personen, die (noch) nicht
darin stehen: Leiharbeit, Praktikanten, Eintritte vor dem ersten Abgleich.

Die Markierung **neu** verschwindet, sobald das Onboarding-Paket ausgeliefert
wurde, spätestens nach 90 Tagen.

## Der Schulungsplan

Was die Anforderungsmatrix für diese Person verlangt, und was davon schon
vorliegt. Zwei Wege führen hinein:

* über die **Personio-Abteilung**,
* über die **Position** — sie wird auf ein Abteilungskürzel abgebildet.

Gibt es für eine Position kein Kürzel, sagt die Liste das ausdrücklich. Ohne
diesen Hinweis entstünden unbemerkt zu wenige Pflichtschulungen — die feine
Ebene griffe einfach nicht, und niemand merkte es.

Die Abteilung lässt sich übersteuern, wenn Personio sie grob oder falsch führt.

## Die Papiere

Zwei Knöpfe je Person:

* **Paket** — Einarbeitungsplan **und** Schulungsübersicht als ein PDF. Das ist
  das Dokument zur Übergabe an die Führungskraft.
* **Übersicht** — nur die Schulungsübersicht (Formblatt 71).

Im Paket bleiben Zeitraum und Kreuze leer. Für einen Neueintritt ist das Blatt
der **Plan**, den er abarbeitet; ein Datum vorzugeben, das noch niemand
terminiert hat, wäre erfunden und stünde hinterher gedruckt im Ordner.

**Das Paket zu erzeugen ist die Übergabe.** Beim ersten Abruf wird sie
vermerkt, und die Markierung „neu" verschwindet. Beim zweiten Abruf passiert
nichts mehr: der Vermerk sagt „ist übergeben worden", nicht „ist zuletzt
gedruckt worden".

## Einarbeitungsinhalte

Unter **HR → Einarbeitung** steht, welcher Inhalt für welche Abteilung
nötig ist und wer dafür Ansprechpartner ist. Der Ansprechpartner hängt am
Inhalt, nicht an der Abteilung — dieselbe Sicherheitsunterweisung wird für alle
von derselben Person gemacht.
`.trim(),
    },
    {
      slug: "organigramm",
      titel: "Organigramm",
      kurz: "Wer wem berichtet — aus Personio.",
      text: `
# Organigramm

Unter **HR → Organigramm**.

## Woher es kommt

Aus Personio. Dort steht an jeder Person, wer ihr Vorgesetzter ist; der
nächtliche Abgleich bringt das mit, und die Seite macht daraus den Baum. Es
gibt nichts zu pflegen — wird in Personio umgehängt, stimmt hier das Bild nach
dem nächsten Abgleich.

## Was oben steht

Wer in Personio **keinen** Vorgesetzten hinterlegt hat. Bei der
Geschäftsführung ist das richtig. Stehen viele oben, ist das ein Hinweis auf
eine Lücke in den Stammdaten — die Zeile über der Liste sagt, wie viele es
sind.

Auch wer an eine **ausgetretene** Person berichtet, steht oben: die Liste führt
nur Aktive. Sonst verschwände der ganze Ast.

## Suchen

Gesucht wird in Name, Position und Abteilung. Ein Treffer erscheint **samt
seiner Vorgesetztenkette** — „Meier" allein sagt nicht, wo Meier im Haus
sitzt.

Gibt es mehrere Standorte, lässt sich darauf einschränken.

## Warum eine Liste und kein gezeichnetes Schaubild

Ein Organigramm mit vierzig Leuten wird als Grafik entweder winzig oder breiter
als jeder Bildschirm. Eine eingerückte Liste lässt sich lesen, durchsuchen und
vorlesen — und ausdrucken, ohne dass etwas abgeschnitten wird.
`.trim(),
    },
    {
      slug: "dokumentenlauf",
      titel: "Dokumentenlauf",
      kurz: "Blätter mit QR erzeugen, aushändigen, zurücknehmen und prüfen.",
      text: `
# Dokumentenlauf

Unter **HR → Dokumentenlauf**.

## Wofür

Zwei Formblätter gehen im Haus denselben Weg: der **Einarbeitungsplan** und der
**Schulungsnachweis**. Sie werden gedruckt, ausgehändigt, von Hand ausgefüllt,
unterschrieben zurückgegeben und abgeheftet.

Ein heruntergeladenes PDF ist danach weg. Niemand weiß, ob es übergeben wurde,
ob es zurückkam, ob es vollständig ist — und genau das fragt das Audit. Ein
Vorgang hält es fest.

## Der Weg

    erstellt → übergeben → zurück → geprüft

Immer genau ein Schritt. Ein Blatt lässt sich nicht prüfen, das nie jemand
bekommen hat.

## Der QR-Code

Jedes erzeugte Blatt trägt oben rechts einen QR-Code mit einer Kennung, dazu
zwei kleine schwarze Quadrate am linken Rand. Der QR ordnet einen später
eingescannten Bogen wieder dem Vorgang zu — **unabhängig davon, wie die Datei
heißt** und wie der Name geschrieben ist. Die Quadrate helfen dabei, den Scan
gerade zu rechnen.

Die Kennung steht auch als Text da. Sie benutzt keine verwechselbaren Zeichen
(kein O neben 0), falls sie doch einmal abgetippt wird.

## Scan hochladen

Über den Knopf **Scan** an der Zeile. PDF, PNG oder JPEG. Die Plattform:

1. liest den QR und prüft, ob er zu diesem Vorgang gehört,
2. sieht in jedem Pflichtfeld nach, ob dort etwas steht,
3. setzt den Vorgang auf *geprüft* und sagt, welche Felder leer sind.

**Erkannt wird, ob etwas im Feld steht — nicht was.** Es ist keine
Texterkennung. Eine Unterschrift ist für dieses Verfahren dasselbe wie ein
Datum: Striche, wo vorher keine waren.

Deshalb steht das Urteil daneben zum **Umkehren**. Wer das Blatt in der Hand
hatte, weiß es besser als die Messung.

## Nachweise

Unter *Details* lassen sich Zertifikate und Teilnahmebescheinigungen anhängen,
auf Wunsch mit Bezug auf eine bestimmte Zeile des Blattes.

## Wenn der QR nicht gelesen wird

Dann sagt die Prüfung das und misst keine Felder. Häufige Ursachen: der Scan
ist zu schwach aufgelöst, stark verdreht, oder die Ecke mit dem QR ist
abgeschnitten. Neu einscannen, gerade und mit mindestens 300 dpi.
`.trim(),
    },
    {
      slug: "zeugnisse",
      titel: "Zeugnisse",
      kurz: "Vom Notenraster zum fertigen Arbeitszeugnis auf der Briefvorlage.",
      text: `
# Zeugnisse

Unter **HR → Zeugnisse**. Nötig ist *Bearbeiten* auf Personal — eine
reine Lesestufe gibt es hier nicht.

## Der Ablauf

1. **Anlegen.** Stammdaten werden beim Anlegen aus Personio **abgeschrieben**,
   nicht verknüpft. Ändert sich später etwas, dokumentiert das Zeugnis weiter,
   was damals galt.
2. **Bewerten.** Je Dimension eine Schulnote von 1 bis 5.
3. **Text bilden.** Zwei Wege, siehe unten.
4. **Setzen.** DOCX auf der echten ACM-Briefvorlage, dazu ein PDF.

## Zwei Wege zum Text

* **Aus Bausteinen** — ohne Netz, ohne KI. Zu jeder Note gibt es hinterlegte
  Formulierungen; der Baukasten setzt sie zusammen. Das Ergebnis ist
  vorhersagbar und immer gleich.
* **Mit KI** — freier formuliert. **Datensparsam:** an die Schnittstelle gehen
  nur Anrede, Rolle, Abteilung, Dauer, Noten und die Freitexte. Name,
  Geburtsdatum und Personalnummer verlassen den Server nicht.

Ohne hinterlegten Schlüssel bleibt der KI-Weg inaktiv; der Baukasten schreibt
dann den vollständigen Text.

## Die Schlussnote

Der Durchschnitt der Einzelnoten. Daraus folgt die Zufriedenheitsformel — von
„stets zu unserer vollsten Zufriedenheit" abwärts. Die Zuordnung steht in der
Maske zum Nachlesen.

## Wer unterschreibt

Zwei Namen stehen darunter, und nur einer ist für alle gleich:

* **links** die fachliche Unterschrift — der oder die Vorgesetzte der Person.
  Sie wird aus Personios Organisationsstruktur aufgelöst: wer in der Näherei
  arbeitet, bekommt die Unterschrift der Näherei.
* **rechts** die personalseitige — für alle dieselbe, hinterlegt unter
  **Einstellungen → Zeugnisse**.

Beide fallen auf einen Freitext zurück, wenn Personio nichts hergibt. Die Seite
zeigt vor dem Erzeugen, wer unterschreiben wird und woher der Name kommt — ohne
das fiele ein fehlender Vorgesetzter erst im gedruckten Zeugnis auf.

## Nie misgendern

Anrede und grammatische Formen richten sich nach dem hinterlegten Geschlecht.
Ist keines gepflegt, benutzt der Text keine Form, die eines voraussetzt.
`.trim(),
    },
    {
      slug: "audits",
      titel: "Audits",
      kurz: "Planung, Phasen-Checkliste, Normbezug und ein Verlauf, der hält.",
      text: `
# Audits

Unter **Qualität**.

## Ein Audit anlegen

Aus einer **Vorlage**: sie bringt die Phasen als Checkliste mit. Wer ohne
Vorlage anlegt, baut die Phasen selbst.

Zu jedem Audit gehören Kategorien und der **Normbezug** — auf welche Stelle
welcher Norm sich die Prüfung beruft. Die Normmatrix steht unter
**Einstellungen → Qualität**.

## Die Phasen

Jede Phase lässt sich abhaken oder mit Begründung überspringen. Eine
übersprungene Phase ohne Begründung gibt es nicht: die Begründung ist der
eigentliche Nachweis.

## Der Verlauf

Jede Änderung an einem Audit schreibt eine Zeile in den Verlauf: wer, wann,
was. **Diese Zeilen lassen sich nicht ändern und nicht löschen** — auch nicht
von einem Admin, auch nicht über die Oberfläche. Die Datenbank lässt es nicht
zu.

Das ist der Unterschied zwischen einem Protokoll und einer Notiz. Ein
Auditverlauf, den man nachbessern kann, ist im Audit wertlos.

## Was hier (noch) nicht steht

Findings und Maßnahmen (CAPA), das Auditprogramm als Jahresplan und der
PDF-Export gibt es nicht. Sie gab es auch im Altsystem nicht; dort waren sie
ausdrücklich außerhalb des Umfangs.
`.trim(),
    },
  ],
};
