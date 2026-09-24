# Schulungen — Katalog, Pflicht und Fälligkeit

Welche Schulung es gibt, für wen sie Pflicht ist und wer sie wann hatte.
Unter `/hr/schulungen`, mit dem Recht `hr`.

## Die Fälligkeit wird gerechnet, nicht gespeichert

Im Altprojekt steht sie als Spalte `naechste_faellig_am`, gefüllt beim Import
aus letztem Termin plus Turnus. Ändert danach jemand den Turnus einer
Schulung — und genau dafür gibt es die Maske —, bleibt die Spalte stehen und
lügt, bis der nächste Import läuft.

Hier rechnet die Sicht `schulung_stand` sie beim Lesen. Der Turnus steht am
Katalog, die Teilnahme kennt ihn erst im Verbund; eine erzeugte Spalte kann das
nicht, eine Sicht schon.

**Die Quartalsangabe der Excel bleibt trotzdem stehen.** „Q3/2025" ist kein
Datum und lässt sich nicht rechnen. Sie steht als Text daneben, damit niemand
eine Genauigkeit hineinliest, die sie nicht hat.

## Nicht zuordenbare Zeilen bleiben

Die Excel kennt Mitarbeiter über die Personalnummer, die in Personio in einem
Freifeld liegt. Gesucht wird über dessen **Beschriftung**, nicht über die
Feld-Kennung: die ist je Personio-Instanz eine andere, und ein Import darf
nicht daran zerbrechen, dass jemand ein Feld neu anlegt.

Findet sich keine Person, wird die Zeile **nicht verworfen**. Sie kommt mit
Personalnummer und Namen in die Datenbank und steht in der Vorschau als solche.
Sonst verschwände Historie, nur weil eine Nummer nicht gepflegt ist.

Drei partielle Eindeutigkeitsindizes halten das zusammen — je einer für
Personio-Kennung, Personalnummer und extern gepflegte Person. Ein gemeinsamer
Index über beide Spalten würde Zeilen mit `NULL` nicht fassen.

## Der Import ergänzt, er ersetzt nicht

Anders als bei den Kompetenzen: die Excel liefert hier nur Turnus und Termine.
Frist, Verantwortlicher und Beschreibung werden in der Oberfläche gepflegt und
bleiben beim Import stehen.

## Vier Geltungen der Anforderungsmatrix

Eine Schulung ist Pflicht für eine von vier Gruppen — die Geltung sagt, für
welche:

| Geltung | Pflicht für |
|---|---|
| `alle` | die gesamte Belegschaft |
| `abteilung` | alle einer Personio-Abteilung (Production) |
| `position` | alle mit einer Personio-Position (CNC Fräser) |
| `abteilung_position` | nur, wo Abteilung und Position zusammentreffen |

Abteilung und Position kommen aus Personio und sind deshalb Text, nicht
Fremdschlüssel. Positionen schreibt Personio uneinheitlich; verglichen wird
normiert (`position_norm`: klein, getrimmt, ohne Mehrfachleerzeichen), ein
Trigger auf `schulung_pflicht` füllt die Spalte.

Die Oberfläche ist eine Kreuztabelle (Schulung × Achsenwert) für die ersten
drei Geltungen und eine kleine Regelliste je Schulung für die Kombination. Das
frühere Kürzel-System (NÄH, CUT, WVK) und seine Rollenbrücke Position → Kürzel
sind entfallen; bestehende Kürzel-Pflichten wurden bei der Umstellung auf
Positions-Pflichten ausgerollt (Migration `0065`).

## Dringlichkeit

Die Liste unter „Was offen ist" sortiert nach Dringlichkeit, nicht nach Namen:

| Stufe | Bedeutung |
|---|---|
| nie absolviert | für diese Person steht kein Termin in der Historie |
| überfällig | Fälligkeit liegt in der Vergangenheit |
| wird fällig | innerhalb der nächsten zwei Monate |

„Nie absolviert" wiegt schwerer als „überfällig" — das eine ist eine Lücke, das
andere eine Verspätung.

## Die Matrix und die Liste beantworten verschiedene Fragen

`/hr/schulungen/offen` sagt: **wer ist als Nächstes dran?** Sortiert nach
Dringlichkeit, eine Zeile je offener Teilnahme — die Liste, nach der jemand
handelt.

`/hr/schulungen/matrix` sagt: **steht für jede Person und jede Schulung ein
Datum?** Das ist die Frage aus dem Audit, und sie braucht die Gegenrichtung:
auch die Person, für die gar nichts eingetragen ist, muss eine Zeile bekommen.
In der Liste taucht sie nicht auf — sie hat ja keine Teilnahme, die offen sein
könnte.

Dafür gibt es `schulung_belegschaft`: eine Sicht über die drei Arten von
Person, die in der Matrix eine Zeile bekommen.

**Die Gesamtmatrix blättert nicht.** Sie steht im Rahmen mit festem Kopf und
fester ersten Spalte und zeigt jede Person auf einmal. Mit der üblichen
Seitengröße (25) waren von 82 Personen knapp ein Drittel zu sehen, und was
fehlte, sah aus wie nicht vorhanden — das ist bei einer Nachweistabelle der
falsche Eindruck. Gesucht wird weiter über das Suchfeld.

| Schlüssel | wer | woher |
|---|---|---|
| `e:<id>` | aktive Personio-Personen und Eintritte | `personio_employees` |
| `x:<uuid>` | extern gepflegte | `externe_personen` |
| `p:<nr>` | Reste der Excel-Historie ohne Personio-Treffer | `schulung_teilnahmen` |

Die dritte Art ist kein Schönheitsfehler, sondern der Grund, warum der Import
nichts verwirft (siehe oben). `schulung_stand` trägt denselben Schlüssel,
damit Zeile und Zelle ohne zweite Abfrage zusammenfinden.

Ausgetretene stehen nicht darin. Ihre Historie bleibt in den Teilnahmen —
aber „wer ist geschult" meint die Belegschaft von heute.

**Gepivotet wird in der Oberfläche, nicht in SQL.** Eine Kreuztabelle in
Postgres bräuchte dynamische Spalten (`crosstab`), also eine Spaltenliste, die
sich bei jeder neuen Schulung ändert. Belegschaft × Katalog ist eine kleine
Menge; das Pivot im Browser kostet nichts und bleibt lesbar.

Die Spaltenüberschriften stehen senkrecht, nicht schräg: eine schräg gestellte
Beschriftung ragt aus ihrer Zelle heraus und wird vom Rollbereich
abgeschnitten — beim ersten Versuch fehlte der Anfang jedes langen Namens.

## Nachweise und der Weg des Blattes

Der Schulungsnachweis läuft über den gemeinsamen Dokumentenlauf: Blatt mit
QR erzeugen, aushändigen, ausgefüllt zurücknehmen, Scan prüfen, Zertifikate
anhängen. Siehe `docs/modules/dokumentenlauf.md`. Unterlagen je Schulung
(Präsentation, Handout) liegen in `schulung_unterlagen` — sie hängen am
Katalog, nicht am Vorgang, weil sie für jede Durchführung gelten.
