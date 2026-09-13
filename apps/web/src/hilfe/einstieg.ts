import type { Gruppe } from "./registry";

export const EINSTIEG: Gruppe = {
  id: "einstieg",
  titel: "Einstieg",
  beschreibung: "Anmelden, sich zurechtfinden, verstehen warum man sieht was man sieht.",
  seiten: [
    {
      slug: "erste-schritte",
      titel: "Erste Schritte",
      kurz: "Anmelden, der Startbildschirm und wo was liegt.",
      text: `
# Erste Schritte

## Anmelden

Die Plattform erreichst du im Firmennetz unter der Adresse, die dir die EDV
genannt hat. Angemeldet wird mit E-Mail und Passwort. Ein Konto legt die
Plattform-Verwaltung an; es gibt keine Selbstregistrierung.

Vergessenes Passwort? Ein Admin setzt es unter **Einstellungen → Nutzer und
Gruppen** zurück und gibt dir das neue einmalig weiter. Sobald das passiert,
wirst du auf allen Geräten abgemeldet — das ist Absicht.

## Der Startbildschirm

Nach dem Anmelden siehst du Kacheln. **Du siehst nur die Anwendungen, für die
du ein Recht hast.** Fehlt eine Kachel, die du brauchst, fehlt dir das Recht —
nicht die Anwendung. Sag der Plattform-Verwaltung, welche Kachel du erwartest.

Oben links steht das Firmenlogo; ein Klick darauf bringt dich immer hierher
zurück. Oben rechts steht deine Anmeldung, daneben die Wahl des
Erscheinungsbilds und drei Zeichen: **Hilfe** (Fragezeichen),
**Einstellungen** (Zahnrad, nur für Plattform-Admins) und **Abmelden**. Wer
die Maus darüber hält, bekommt die Beschriftung.

Auf jeder Seite außer dieser steht darunter der **Pfad** — *Start › Personal ›
Schulungen*. Jede Station davon ist ein Verweis; das ist der Weg eine Ebene
nach oben, ohne den Zurück-Knopf des Browsers. Auf einer Detailseite endet der
Pfad bei der Liste, aus der sie stammt.

## Zahlen in der Kopfzeile

Zwei Zeichen tragen eine Zahl, und beide sieht nur, wer etwas damit anfangen
kann:

* **Glocke** — gemeldete Seiten, die noch niemand angesehen hat. Nur für die
  Plattform-Verwaltung. Die Zahl geht auf null, sobald die Liste unter
  *Einstellungen → Gemeldete Seiten ansehen* offen war.
* **Hakenliste** — offene Maßnahmen aus der KPI-Bewertung, über alle
  Kennzahlen zusammen. Sie wird **rot**, sobald eine davon überfällig ist;
  wie viele das sind, steht in der Beschriftung. Nur für die, die eine
  Maßnahme auch abhaken dürfen.

Eine Null zeigt keines der beiden Zeichen an — eine Zahl, die immer dasteht,
sieht man nach einer Woche nicht mehr.

## Hell oder dunkel

Drei Felder oben rechts: **hell**, **dunkel** und **wie das System**.
Vorgewählt ist das letzte — dann folgt die Plattform der Einstellung deines
Rechners und wechselt mit, wenn der abends umschaltet.

Die Wahl gehört zum **Gerät**, nicht zum Konto: am Arbeitsplatz hell und am
Laptop dunkel ist damit möglich. Sie überlebt das Abmelden und gilt sofort,
auch in anderen offenen Tabs.

## Wo liegt was

| Was du suchst | Wo es liegt |
|---|---|
| Umsatz, Aufträge, Angebote | Kennzahlen → Vertrieb |
| Liefertreue, Ladenhüter | Kennzahlen → Einkauf |
| Aufträge in Verzug, Wartung | Produktion |
| Prüfmengen, Reklamationen, Audits | Qualität |
| Materialkosten, Personalkosten | Kennzahlen → Finanzen |
| Überstunden, Krankheit, Belegschaft | Personal |
| Schulungen, Zeugnisse, Onboarding | HR → jeweilige Seite |
| Dateien einlesen | Uploads |

## Zeiträume

Die Kennzahlenseiten haben oben einen Zeitraum. Er gilt für alles darunter —
Kacheln, Verläufe, Tabellen. Änderst du ihn, rechnet die Seite neu; gespeichert
wird er nicht, beim nächsten Aufruf steht wieder die Vorgabe.

## Wenn etwas leer bleibt

Eine leere Kachel ist keine Null. Sie heißt in aller Regel: die Grundlage
fehlt. Drei häufige Fälle:

* **Keine Datei eingelesen.** Die Kennzahlen rechnen auf hochgeladenen
  ERP-Auszügen. Siehe *Daten hochladen*.
* **Eine Einstellung fehlt.** Die Krankheitsquote braucht die Liste der
  Abwesenheitsarten, die als Krankheit zählen. Ohne sie bleibt die Kachel
  sichtbar leer — absichtlich, statt still eine Null zu zeigen.
* **Der Personio-Abgleich lief nicht.** Das HR-Dashboard zeigt oben,
  wann er zuletzt lief und ob er Fehler meldete.

## Etwas stimmt nicht

Unten rechts steht auf jeder Seite der Knopf **App Feedback melden**. Er schickt den
Seitennamen und deinen Text an die Plattform-Verwaltung. Das ist der kürzere
Weg als eine Mail, weil die Seite gleich mitkommt.
`.trim(),
    },
    {
      slug: "rechte",
      titel: "Rechte und Gruppen",
      kurz: "Warum du bestimmte Kacheln siehst — und andere nicht.",
      text: `
# Rechte und Gruppen

## Der Grundgedanke

Rechte hängen nicht an Personen, sondern an **Gruppen**. Eine Person ist in
einer oder mehreren Gruppen, und eine Gruppe hat je Anwendung eine Stufe.

Das hat einen praktischen Grund: kommt jemand neu dazu, wird er einer Gruppe
zugeordnet und hat damit genau das, was die Kollegen mit derselben Aufgabe
haben. Niemand muss eine Liste von Häkchen nachbauen und dabei eines vergessen.

## Drei Stufen

| Stufe | Was sie erlaubt |
|---|---|
| kein Zugriff | Die Kachel erscheint gar nicht. |
| Ansehen | Lesen. Keine Änderung, kein Upload. |
| Bearbeiten | Lesen und pflegen. |
| Verwalten | Zusätzlich die Einstellungen dieser Anwendung. |

**Plattform-Verwaltung** ist eine eigene Anwendung. Wer sie auf *Verwalten*
hat, ist überall Admin — auch dort, wo für seine Gruppen nichts eingetragen
ist. Das ist der Notschlüssel, und es sollen wenige haben.

## Änderungen wirken bei der nächsten Anmeldung

Deine Rechte stehen in deinem Anmeldetoken. Bekommst du eine neue Gruppe,
siehst du die neue Kachel **nach dem nächsten Anmelden** — nicht sofort. Wer
nicht warten will, meldet sich ab und wieder an.

## Warum Rechte nicht nur die Oberfläche betreffen

Die Kacheln zu verstecken wäre kein Schutz. Die Prüfung sitzt deshalb in der
Datenbank: jede Tabelle hat Regeln, die bei jeder Abfrage greifen — auch wenn
jemand die Oberfläche umgeht. Wer kein Recht auf Personaldaten hat, bekommt
keine Zeile, egal wie er fragt.
`.trim(),
    },
  ],
};
