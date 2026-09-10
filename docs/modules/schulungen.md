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

## Zwei Ebenen der Anforderungsmatrix

Eine Schulung ist Pflicht für eine Abteilung — und „Abteilung" gibt es zweimal:
als feines Kürzel aus der Excel (NÄH, CUT, WVK) und als grobe Personio-Abteilung
(Production). Beide Wertelisten kommen aus Fremdsystemen und sind deshalb Text,
nicht Fremdschlüssel.

## Dringlichkeit

Die Liste unter „Was offen ist" sortiert nach Dringlichkeit, nicht nach Namen:

| Stufe | Bedeutung |
|---|---|
| nie absolviert | für diese Person steht kein Termin in der Historie |
| überfällig | Fälligkeit liegt in der Vergangenheit |
| wird fällig | innerhalb der nächsten zwei Monate |

„Nie absolviert" wiegt schwerer als „überfällig" — das eine ist eine Lücke, das
andere eine Verspätung.

## Was noch fehlt

Unterlagen je Schulung, Nachweise und Zertifikate, das Schulungsprotokoll als
PDF und der QR-Scan sind im Altprojekt vorhanden und hier noch nicht portiert.
Sie stehen in `docs/backlog.md`.
