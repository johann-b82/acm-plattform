# Kompetenzen — die Qualifikationsmatrix

Was eine Stelle verlangt und wie weit es erfüllt ist. Zeilen sind
Qualifikationen, Spalten sind Personen, eine Zelle trägt zwei Zahlen:
Anforderungslevel 0–4 und Erfüllungsgrad 0–100 %.

Unter `/hr/kompetenzen`, mit dem Recht `hr` — es sind personenbezogene
Leistungsbewertungen.

## Der Bereich gilt für Liste und Einlesen

Die Bereichswahl in der rechten Leiste filtert die angezeigten Matrizen **und**
bestimmt, wohin eine eingelesene Datei geht. Bis dahin tat sie nur das Zweite:
Sie sah aus wie ein Filter und wirkte nicht auf die Liste. Im Altprojekt wählen
die Bereichs-Reiter ebenso die angezeigte Matrix.

## Die Excel ist die Herkunft, nicht die Heimat

Die vier Bereichsdateien (Produktion, Verwaltung, Safety, Quality) werden
eingelesen; danach wird hier gepflegt. Der Import ersetzt ein Blatt
vollständig — deshalb zeigt er **vorher**, was er täte: wie viele
Qualifikationen, Personen und Bewertungen ankommen, wie viele Spaltenköpfe in
Personio gefunden wurden und welche nicht.

Das ist keine Höflichkeit. Wer nach dem letzten Import in der Oberfläche
gepflegt hat, verliert das beim nächsten, und das soll niemand aus Versehen
auslösen.

### Die Kopfzeile wandert

Je nach Datei sitzt sie auf Zeile 4 bis 6. Statt sie festzuschreiben, sucht
der Parser den Text „Anzahl Mitarbeiter". Drei Tests halten alle drei Zeilen
fest.

### Zwei Zahlen kommen bewusst nicht mit

„Anzahl Mitarbeiter" und „Durchschnitt" sind in der Excel Formeln. Beides ist
aus den Bewertungen ableitbar, und eine gespeicherte Ableitung geht beim ersten
Schreibvorgang in der Oberfläche daneben. Die Sicht `kompetenz_stand` rechnet
sie beim Lesen — im Browser nachgemessen: eine geänderte Zelle senkte den
Zeilendurchschnitt sofort von 80 auf 70.

## Die Namenszuordnung ist die interessante Stelle

Die Excel schreibt Namen, wie sie gerade passen; Personio führt sie
vollständig. Zwei Stufen:

1. Der Name stimmt genau (Groß- und Kleinschreibung egal).
2. **Alle** Namensbestandteile der Excel zeigen auf dieselbe Person. Das deckt
   „Fernando Gomes" → „Fernando Gomes Ferreira" ab.

Bleiben mehrere Personen übrig — „Meier" bei zwei Meiers —, wird bewusst
**nicht** zugeordnet. Eine falsche Zuordnung wäre schlimmer als keine: an ihr
hängen Leistungsbewertungen.

Die Spalte behält in jedem Fall ihren Namen aus der Excel; ohne das verlöre
eine nicht zugeordnete Spalte ihre Beschriftung. Spaltenköpfe wie „N/A" oder
„TBD" gelten als Platzhalter und werden gar nicht erst gesucht.

## Die Oberfläche

Die Matrix ist kein `<Table>`-Baustein, sondern ein eigenes Raster: die
Kopfspalte bleibt beim seitlichen Scrollen stehen. Bei dreißig Personen weiß
sonst niemand mehr, welche Zeile er liest.

Die Zeilen sind nach Kategorie klappbar; **alle Gruppen starten offen**. War
nur die erste offen, wirkten die eingeklappten Kategorien (Zuschnitt,
Handzuschnitt, Technische Anforderungen …) wie fehlend. Wer eine Gruppe nicht
braucht, klappt sie selbst zu.

Eine **Lücke** ist eine Zelle mit Anforderung, deren Erfüllungsgrad darunter
bleibt; sie steht in Warnfarbe. Ohne Anforderung gibt es nichts zu erfüllen —
eine leere Anforderung ist keine Lücke, sondern eine Nichtzuständigkeit.

Eine Zelle ohne beide Zahlen wird gelöscht, nicht leer gespeichert; die
Datenbank lässt sie gar nicht erst zu.

## Personio-Rückschreiben

Das **Personio-Rückschreiben** (ein Nachweis-PDF in die Personio-Dokumente der
Person) **ist übernommen** — nicht als toter Code, sondern passend zur
zustandslosen Architektur umgebaut: ein Trigger (Migration 0051) merkt bei
einer Änderung einen Auftrag in `personio_nachweise` vor, `pg_cron` stößt alle
zehn Minuten an, `compute` erzeugt das PDF und lädt es hoch
(`services/compute/app/personio/nachweise.py`, siehe
`docs/modules/personio-writeback.md`).

Wie schon im Altprojekt bleibt es **inert, bis die Voraussetzungen stehen**: es
braucht Personio-Schreib-Scopes, die die hinterlegten Zugangsdaten nicht haben,
und eine Dokumentenkategorie, die noch nicht gesetzt ist. Ohne Schalter,
Kategorie und Scopes merkt der Trigger gar nichts erst vor.
