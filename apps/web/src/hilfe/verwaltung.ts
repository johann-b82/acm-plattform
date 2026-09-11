import type { Gruppe } from "./registry";

export const VERWALTUNG: Gruppe = {
  id: "verwaltung",
  titel: "Administration",
  beschreibung: "Einstellungen, Konten, Bildschirme, Abgleich und Betrieb.",
  seiten: [
    {
      slug: "einstellungen",
      titel: "Die Einstellungsseite",
      kurz: "Alles an einer Stelle, nach Bereich gruppiert — und nur für Admins.",
      text: `
# Die Einstellungsseite

Unter **Einstellungen**, erreichbar für **Plattform-Admins**.

## Warum eine Seite

Vorher lag jede Einstellung dort, wo sie fachlich hingehörte — die ATR-Vorlagen
im Teilekatalog, der Eingangsordner unter den Lieferungen, die Konten in einer
eigenen Verwaltung. Wer etwas einstellen wollte, musste wissen, wo.

Jetzt gibt es einen Ort und eine Gliederung. Was hier steht, **gilt für alle**:
ein Zielwert, eine Vorlage je Programm, ein Eingangsordner. Nichts davon hängt
daran, wer gerade angemeldet ist — deshalb auch ein Tor für die ganze Seite und
keine Rechteprüfung je Abschnitt.

## Die Bereiche

| Bereich | Was darin steht |
|---|---|
| Kennzahlen | Zielwerte der Dashboards |
| Personal | Krankheitsarten, Produktionsabteilungen, Kompetenzfelder |
| ATR | Vorlagen je Programm und der Eingangsordner |
| Qualität | Normmatrix und Phasenvorlagen für Audits |
| Sensoren | Die Messgeräte im Netz |
| Zeugnisse | Firma, Ort und die beiden Unterschriften |
| Erscheinungsbild | Das Firmenlogo für die Formblätter |
| Anzeigen | Die Adressen für die Bildschirme |
| Nutzer und Gruppen | Konten, Gruppen, Rechte |

Neben jeder Bereichsüberschrift steht ein kleines Zeichen mit einer Erklärung,
was die Einstellungen dieses Bereichs bewirken.

## Personio-Listen statt Abtippen

Bei den Personal-Einstellungen stehen die Werte **zur Auswahl**: die
Abwesenheitsarten holt die Plattform live von Personio, Abteilungen und Felder
aus dem abgeglichenen Bestand. Eine Zahl wie 568234 sagt niemandem etwas.

Ist Personio gerade nicht erreichbar, kommt trotzdem eine Antwort: die Arten
stammen dann aus den bereits abgeglichenen Abwesenheiten, und ein Hinweis sagt
warum. Das Textfeld bleibt daneben stehen — die Maske muss bedienbar bleiben.

## Das Logo

PNG oder JPEG, höchstens 5 MB. Es steht an zwei Stellen: **oben links in der
Anwendung** und in der Kopfzeile jedes erzeugten Formblatts —
Einarbeitungsplan, Wartungsnachweis, Zeugnis, Schulungsübersicht. Ist keins
hinterlegt, steht oben links der Schriftzug „ACM-Plattform".

Kein SVG. Eine SVG-Datei kann Skripte tragen und müsste gereinigt werden — und
in die Formblätter lässt sie sich ohnehin nicht einbetten. Der Fall entfällt,
statt behandelt zu werden.

Fehlt das Logo, entstehen die Blätter trotzdem — ohne Bild, aber vollständig.

Auf der **Anmeldeseite** steht es nicht: der Eimer ist nicht öffentlich, und
ihn dafür zu öffnen hieße, das Logo jedem im Netz zu zeigen, der die Adresse
errät. Dafür ist der Gewinn zu klein.
`.trim(),
    },
    {
      slug: "nutzer-verwalten",
      titel: "Nutzer und Gruppen",
      kurz: "Konten anlegen, Gruppen bilden, Rechte vergeben, Passwörter zurücksetzen.",
      text: `
# Nutzer und Gruppen

Unter **Einstellungen → Nutzer und Gruppen**.

## Eine Person anlegen

E-Mail eintragen, anlegen. Die Plattform erzeugt ein Passwort und zeigt es
**genau einmal** an. Es wird nicht per Mail verschickt und lässt sich nicht
noch einmal ansehen — wer es verliert, bekommt ein neues.

## Gruppen und Rechte

Rechte hängen an Gruppen, nicht an Personen. Eine Gruppe bekommt je Anwendung
eine Stufe; eine Person kommt in eine oder mehrere Gruppen.

Wer neu dazukommt, wird einer Gruppe zugeordnet und hat damit genau das, was
die Kollegen mit derselben Aufgabe haben.

## Passwort zurücksetzen

Ein Knopf an der Person. Auch hier erscheint das neue Passwort genau einmal.

**Alle Sitzungen dieser Person enden dabei** — auf allen Geräten. Das ist
Absicht: wenn ein Passwort zurückgesetzt wird, ist meistens etwas passiert.

## Wann Änderungen wirken

Die Rechte einer Person stehen in ihrem Anmeldetoken. Eine neue Gruppe wirkt
deshalb **bei der nächsten Anmeldung**, nicht sofort.

## Was nicht geht

Die Plattform zeigt nie ein bestehendes Passwort an, und niemand — auch kein
Admin — kann eines auslesen. Gespeichert ist nur ein Prüfwert.
`.trim(),
    },
    {
      slug: "anzeigen",
      titel: "Anzeigen für die Bildschirme",
      kurz: "Geburtstage und Neuzugänge auf den Tafeln im Haus.",
      text: `
# Anzeigen für die Bildschirme

Eingerichtet unter **Einstellungen → Anzeigen**.

## Was auf den Tafeln läuft

Zwei Anzeigen: **Geburtstage der Woche** und **Neu im Team**. Beide laufen
ohne Anmeldung — ein Bildschirm meldet sich nicht an.

## Eine Adresse erzeugen

Anzeige wählen, Gültigkeitsdauer wählen, erzeugen. Die fertige Adresse
erscheint einmal zum Kopieren und wird in den Playlist-Eintrag des
Signage-Players eingetragen.

Die Adresse trägt einen **unterschriebenen Token**. Daraus folgt dreierlei:

* Eine Tafel sieht genau **eine** Anzeige. Ein Token für Geburtstage öffnet die
  Neuzugänge nicht.
* Der Token **läuft ab** (Vorgabe ein Jahr). Ein Eintrag, den niemand mehr
  pflegt, hört von selbst auf zu zeigen.
* **Alle auf einmal sperren** geht, indem die EDV das gemeinsame Geheimnis
  wechselt. Es gibt keine Liste zu pflegen — und keine, die man vergessen kann.

Der Preis: eine erzeugte Adresse lässt sich später nicht noch einmal ansehen.
Verloren heißt neu erzeugen; das ist ein Klick.

## Was auf der Tafel steht

Name, Abteilung, Wochentag. **Kein Geburtsdatum, kein Alter.** Eine Tafel hängt
im Flur und wird von jedem gesehen, der vorbeigeht; der Wochentag reicht für
„heute hat jemand Geburtstag".

Ein Foto erscheint nur für Personen, die gerade auf einer Tafel stehen.

## Wenn die Tafel etwas anderes zeigt

* **„Kein Token"** — in der Adresse fehlt der Token. Neu erzeugen und
  eintragen.
* **„Der Token ist abgelaufen"** — neu erzeugen.
* **„Der Token passt nicht zur Unterschrift"** — die Adresse ist verstümmelt
  (oft ein Zeilenumbruch beim Kopieren) oder das Geheimnis wurde gewechselt.
`.trim(),
    },
    {
      slug: "personio",
      titel: "Personio-Abgleich",
      kurz: "Was nachts geholt wird, was das kostet und was zu tun ist, wenn er steht.",
      text: `
# Personio-Abgleich

## Was geholt wird

Nachts holt die Plattform aus Personio:

* **Stammdaten** — Name, Abteilung, Position, Eintritt, Arbeitszeitmodell,
* **Anwesenheiten** — die gebuchten Zeiten,
* **Abwesenheiten** — aus zwei Quellen, weil Personio nicht alle Arten über
  dieselbe Schnittstelle herausgibt.

Darauf rechnen die Personal-Kennzahlen, der Onboarding-Plan, die
Schulungszuordnung und die Unterschrift im Zeugnis.

## Von Hand anstoßen

Auf der Personal-Seite, mit dem Recht *Verwalten*. Dauert je nach Fenster ein
bis mehrere Minuten.

## Wenn er scheitert

Die Personal-Seite zeigt oben den Fehlertext. Die drei häufigsten Ursachen:

* **Zugangsdaten abgelehnt** — die Anmeldedaten in der Umgebung stimmen nicht
  mehr.
* **Personio drosselt** — bei Massenabrufen. Die Plattform wiederholt mit
  wachsendem Abstand; hält es an, ist das Fenster zu groß gewählt.
* **Nicht erreichbar** — Netz oder Namensauflösung.

## Was der Abgleich nicht tut

Er schreibt **nichts nach Personio zurück**. Die Plattform liest.
`.trim(),
    },
    {
      slug: "sicherheit",
      titel: "Sicherheit und Datenschutz",
      kurz: "Was geschützt ist, was bewusst offen bleibt und warum.",
      text: `
# Sicherheit und Datenschutz

## Die Prüfung sitzt in der Datenbank

Kacheln zu verstecken wäre kein Schutz. Jede Tabelle hat Regeln, die bei jeder
Abfrage greifen — auch wenn jemand die Oberfläche umgeht. Wer kein Recht auf
Personaldaten hat, bekommt keine Zeile, egal wie er fragt.

## Was nicht in der Datenbank steht

Geheimnisse stehen in der Umgebung des Servers, nicht in der Datenbank: das
Passwort für den Dateiserver, der Schlüssel für die Sensor-Communities, das
Geheimnis für die Bildschirmadressen. Sonst bräuchte es zusätzlich einen
Schlüssel zum Entschlüsseln — und der Geheimtext läge in jedem Abzug.

## Datensparsamkeit

Zwei Stellen geben bewusst weniger heraus, als sie könnten:

* **Die Bildschirmanzeigen** zeigen Name, Abteilung und Wochentag. Kein
  Geburtsdatum, kein Alter. Das Foto antwortet nur für Personen, die gerade auf
  einer Tafel stehen.
* **Die KI-Textbildung im Zeugnis** bekommt Anrede, Rolle, Abteilung, Dauer,
  Noten und Freitexte. Name, Geburtsdatum und Personalnummer verlassen den
  Server nicht.

## Wohin sich Dienste verbinden dürfen

Der Dateiserver-Zugriff und die Sensorabfragen gehen nur an Ziele aus einer
Freigabeliste. Ein Admin trägt ein Ziel ein — aber nur eines, das dort steht.

## Dateien, die Nutzer hochgeladen haben

Sie werden so ausgeliefert, dass sie nicht im Ursprung der Anwendung laufen
können. Eine als HTML abgelegte Datei bleibt eine Datei.

## Was protokolliert wird

Nur Fehler. Erfolgreiche Anfragen stehen in keinem Protokoll — das war im
Altsystem die Ursache dafür, dass einmal die Platte volllief.

Der Auditverlauf ist die Ausnahme: er hält jede Änderung fest, und diese Zeilen
lassen sich nicht ändern und nicht löschen.
`.trim(),
    },
  ],
};
