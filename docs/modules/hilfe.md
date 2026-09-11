# Hilfe in der Anwendung

22 Seiten unter `/hilfe`, erreichbar über die Kopfzeile für **jeden
Angemeldeten**.

| Teil | Ort |
|---|---|
| Übersicht und Suche | `/hilfe` |
| Eine Seite | `/hilfe/<verweis>` |
| Der Text | `apps/web/src/hilfe/*.ts` |

## Kein Rechte-Tor

Die Hilfe beschreibt die Plattform. Jeder Angemeldete darf nachlesen, was es
gibt — auch das, wofür ihm gerade das Recht fehlt. Sonst wüsste niemand, worum
er bitten müsste. Daten stehen keine darin.

## Warum TypeScript-Module und keine `.md`-Dateien

Next.js baut `standalone`, und dabei landen nur Dateien im Abbild, die der
Build verfolgt hat. Eine Markdown-Datei, die erst zur Laufzeit gelesen würde,
wäre dort nicht: die Hilfe wäre in der Entwicklung da und in Produktion weg.
Ein Modul ist Teil des Builds.

Der Preis: der Text steht in einem Template-Literal, und zwei Zeichen brauchen
Aufmerksamkeit.

* Ein **Backtick** für eine Code-Auszeichnung muss escaped werden, sonst endet
  die Zeichenkette mittendrin. Aufgelaufen bei `` `.xls` ``.
* Ein **gerades Anführungszeichen** in einer `kurz:`- oder `titel:`-Zeile
  beendet die Zeichenkette. Aufgelaufen bei `„in Verzug"` — das schließende
  gehört als `"` gesetzt, nicht als `"`.

Beides fällt beim Typprüfen auf, aber mit einer Fehlermeldung, die 90 Zeilen
weiter unten zeigt. Wer hier schreibt, sollte es wissen.

## Die Seiten des Altprojekts sind nicht übernommen

Dort stehen 21 Seiten, und sie beschreiben dessen Oberfläche: Sprachumschalter,
Directus-Benutzerverwaltung, Signage in der Anwendung, Organigramm. Davon gibt
es hier nichts oder anderes. Abgeschrieben wären sie ab dem ersten Tag falsch.

Der **Aufbau** ist geblieben — Einstieg, Anwendung, Administration —, der
Inhalt ist für diesen Stand geschrieben.

## Gliederung

| Gruppe | Seiten |
|---|---|
| Einstieg | Erste Schritte, Rechte und Gruppen |
| Kennzahlen | So lesen sich die Kennzahlen, Vertrieb, Einkauf, Produktion, Qualität, Finanzen, Personal |
| Arbeiten mit der Plattform | Daten hochladen, Schulungen, Kompetenzen, Onboarding und Einarbeitung, Dokumentenlauf, Zeugnisse, Audits |
| Fachanwendungen | ATR, FAIR, Newsletter, Sensoren, Wartung |
| Administration | Einstellungen, Nutzer und Gruppen, Anzeigen, Personio-Abgleich, Sicherheit |

## Suche

Volltext über Titel, Kurztext und Inhalt, im Browser. Die Hilfe ist rund 1.200
Zeilen — dafür braucht es keinen Index und keine Abfrage. Gesucht wird ab zwei
Zeichen; darunter käme bei jedem Tastendruck die halbe Hilfe zurück.

## Darstellung

`react-markdown` mit `remark-gfm` (Tabellen). **Rohes HTML wird nicht
gesetzt** — die Hilfe ist ein Text, kein Baukasten.

Anders als der Newsletter folgt sie den Theme-Farben: sie wird am Bildschirm
gelesen, nicht gedruckt. Deshalb Variablen statt fester Werte — sonst stünde im
dunklen Erscheinungsbild schwarze Schrift auf dunklem Grund.

## Ein Test hält den Aufbau

`apps/web/src/lib/__tests__/hilfe.test.ts`: kein Verweis zweimal, jede Seite
mit Titel, Kurztext und Inhalt, jede beginnt mit einer Überschrift erster
Ordnung, jeder Verweis ohne Sonderzeichen. Das sind die Fehler, die beim
Schreiben passieren und niemandem auffallen.
