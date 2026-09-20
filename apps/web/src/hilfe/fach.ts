import type { Gruppe } from "./registry";

export const FACH: Gruppe = {
  id: "fach",
  titel: "Fachanwendungen",
  beschreibung: "ATR, FAIR, Newsletter, Sensoren und Wartung.",
  seiten: [
    {
      slug: "atr",
      titel: "ATR — Lieferpapiere",
      kurz: "Lieferschein einlesen, Teile zuordnen, Papiere erzeugen.",
      text: `
# ATR — Lieferpapiere

Unter **ATR**. Zwei Rechtestufen: durchsehen mit *Bearbeiten*, ein Ziel
eintragen nur als Plattform-Admin.

## Der Ablauf

1. **Lieferschein einlesen** — von Hand hochgeladen oder aus dem
   Eingangsordner auf dem Dateiserver.
2. **Positionen zuordnen** — jede Position wird gegen den Teilekatalog
   geprüft.
3. **Papiere erzeugen** — die Dokumente entstehen und werden an der Lieferung
   abgelegt.

## Der Teilekatalog muss vollständig sein

Die Produktion führt 287 Teile aus neun Referenzmappen. **Eine einzelne Mappe
reicht nicht** — es gibt eine eigene Übernahme, die alle einliest.

Das ist die Falle, die beim Einrichten am meisten Zeit kostet: mit einem
unvollständigen Katalog bleiben Positionen unzugeordnet, und die Diagnose
zeigt auf den Lieferschein statt auf den Katalog.

## Der Eingangsordner

Der Dienst sieht regelmäßig in einem Ordner auf dem Dateiserver nach und liest
neue Lieferscheine ein. Eingerichtet wird er unter **Einstellungen → ATR**.

Zwei Dinge sind dort bewusst nicht einstellbar:

* Das **Passwort** steht in der Umgebung des Servers, nicht in der Datenbank.
  Sonst bräuchte es zusätzlich einen Schlüssel zum Entschlüsseln, und der
  Geheimtext läge in jedem Abzug.
* **Wohin** sich der Dienst anmelden darf, begrenzt eine Freigabeliste. Ein
  Admin kann ein Ziel eintragen, aber nur eines aus dieser Liste.

## Vorlagen

Was in jedem Dokument eines Programms gleich steht, liegt als Vorlage unter
**Einstellungen → ATR**. Die echten Kundenvorlagen liegen bewusst nicht im
Quellcode.
`.trim(),
    },
    {
      slug: "fair",
      titel: "FAIR — Erstmusterprüfung",
      kurz: "Zeichnung mit nummerierten Ballons.",
      text: `
# FAIR — Erstmusterprüfung

Unter **FAIR**.

## Wofür

Eine Zeichnung wird hochgeladen, und auf ihr werden die zu prüfenden Maße mit
nummerierten Ballons markiert. Aus den Ballons entsteht die Prüfliste — die
Nummerierung auf der Zeichnung und in der Liste ist dieselbe.

## Arbeiten mit Ballons

Ein Ballon wird gesetzt, verschoben und nummeriert. Die Nummern bleiben stabil:
wird ein Ballon in der Mitte gelöscht, rutschen die folgenden nicht nach. Sonst
zeigte ein bereits gedrucktes Prüfprotokoll auf das falsche Maß.
`.trim(),
    },
    {
      slug: "newsletter",
      titel: "Newsletter",
      kurz: "Die vierteljährliche Ausgabe schreiben und als PDF setzen.",
      text: `
# Newsletter

Unter **Newsletter**.

## Aufbau

Eine Ausgabe besteht aus Kapiteln, ein Kapitel aus Einträgen. Ein Eintrag trägt
Text und wahlweise Bilder. Die Reihenfolge lässt sich durch Ziehen ändern.

## Zwei Ansichten

* **Redaktion** — hier wird geschrieben.
* **Ansicht** — so sieht die Ausgabe aus, und so wird sie gedruckt.

Die Newsletter-Seiten stehen bewusst **nicht** in den Farben der Oberfläche:
sie sind ein Druckerzeugnis auf weißem Papier, am Bildschirm wie im PDF. Ein
dunkles Erscheinungsbild setzte sonst weiße Schrift auf ein weißes Blatt.

## Text

Die Einträge nehmen Markdown: Überschriften, Fettung, Listen, Links. Rohes HTML
wird nicht gesetzt — ein Newsletter ist ein Text, kein Baukasten.
`.trim(),
    },
    {
      slug: "sensoren",
      titel: "Sensoren",
      kurz: "Temperatur und Luftfeuchtigkeit aus dem Netz, in einem einstellbaren Takt.",
      text: `
# Sensoren

Ansicht unter **Sensoren**, eingerichtet unter **Einstellungen → Sensoren**.

## Was passiert

In einem **globalen Takt** werden alle eingetragenen Geräte gefragt. Was sie
liefern, wird zur Zeitreihe und zur Kachel. Der Takt gilt für alle Geräte
gemeinsam und steht unter **Einstellungen → Sensoren** (Vorgabe: stündlich). Er
ist frei in ganzen Sekunden wählbar; **0 schaltet die selbsttätige Abfrage ab**
— von Hand messen bleibt möglich. Feiner als eine Minute wird der Takt nicht,
weil die Datenbank nur zur vollen Minute anstößt.

## Messung und Versuch sind zweierlei

Eine gescheiterte Abfrage ist keine Messung — sie wird trotzdem festgehalten.
Ohne das sähe ein stiller Ausfall genauso aus wie ein Gerät, das gerade nichts
zu melden hat.

Die Kachel zeigt deshalb beides: den letzten **Messwert** und den letzten
**Versuch**. Liegen die weit auseinander, antwortet das Gerät nicht mehr.

## Grenzwerte

Die Grenzwerte gelten **global für alle Geräte** (unter **Einstellungen →
Sensoren**): ab wann Temperatur oder Luftfeuchte als zu hoch oder zu niedrig
gelten. Die Kachel färbt sich entsprechend.

## Einrichten

Ein Gerät braucht Adresse, Kennung und die Community. Die **Community wird
verschlüsselt abgelegt**; der Schlüssel steht in der Umgebung des Servers.
Ohne ihn lässt sich kein Gerät anlegen.

Erreichbar sind nur Geräte aus einer Freigabeliste — dieselbe Überlegung wie
beim ATR-Dateiserver: ein Admin trägt ein Ziel ein, aber nur eines aus der
Liste.
`.trim(),
    },
    {
      slug: "wartung",
      titel: "Wartung und Maschinen",
      kurz: "Wiederkehrende Aufgaben, Herstellerpläne und der Nachweisbogen.",
      text: `
# Wartung und Maschinen

Unter **Produktion**.

## Maschinen und Aufgaben

Je Maschine stehen die wiederkehrenden Wartungsaufgaben mit ihrem Intervall:
wöchentlich, monatlich, quartalsweise oder **alle n Wochen**.

Die Angabe *n* gibt es nur beim Intervall „alle n Wochen" — und dort muss sie
stehen. Eine Datenbankbedingung hält beides fest: keine Wochenzahl bei
„monatlich", keine fehlende bei „alle n Wochen".

## Dateien an der Maschine

Herstellerpläne, Handbücher, Fotos. Sie hängen an der Maschine, nicht an einer
einzelnen Wartung — sie gelten für jede.

## Der Nachweisbogen

Je Maschine und Halbjahr ein PDF: ein Raster aus Aufgaben und Kalenderwochen
zum Abhaken an der Maschine. Quer, weil ein halbes Jahr in die Breite geht.

Das Blatt entsteht leer. Es wird an der Maschine ausgefüllt und danach
abgeheftet oder eingescannt.
`.trim(),
    },
  ],
};
