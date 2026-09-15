# Wartung — Maschinen, Aufgaben und der Nachweisbogen

Eine Maschine, ihre wiederkehrenden Aufgaben, die Dateien dazu und ein Bogen
zum Aushängen. Unter `/produktion`, mit dem Recht `production`.

## Es gibt keine Terminliste

Das ist die wichtigste Entscheidung dieses Moduls, und sie stammt aus dem
Altprojekt: das Intervall ist eine **Regel**, kein Termin. Nirgends steht, wann
eine Aufgabe das nächste Mal fällig ist.

Der Nachweis ist ein Raster über ein Halbjahr — Kalenderwochen quer, Aufgaben
untereinander. Wer wartet, zeichnet in der Spalte der Woche ab. Das Blatt hängt
an der Maschine, und der zurückgescannte, unterschriebene Bogen ist der Beleg.

Eine Terminverwaltung wäre der naheliegende „Fortschritt". Sie hätte den
Nachteil, dass jemand sie pflegen müsste: jede verschobene Wartung, jeder
Sonderfall, jede Maschine im Stillstand. Ein Raster an der Wand pflegt sich
selbst.

## Die Wochenzahl gehört zu genau einem Intervall

`alle_n_wochen` braucht eine Zahl — und die anderen Intervalle dürfen keine
haben:

```sql
constraint wartungsaufgaben_wochen_passend check (
    (intervall = 'alle_n_wochen' and wochen is not null and wochen >= 1)
    or (intervall <> 'alle_n_wochen' and wochen is null)
)
```

Im Altprojekt fehlt die zweite Hälfte. Eine monatliche Aufgabe kann dort eine
sinnlose „14" tragen, die nirgends gezeigt und nie geprüft wird.

## Der Bogen

Zwei Blätter, bewusst getrennt:

| Blatt | Wann | Raster |
|---|---|---|
| Periodisch | immer | KW 1–26 oder 27–52, gruppiert nach Intervall |
| Täglich | nur wenn es tägliche Aufgaben gibt | Tage 1–31, Monat zum Eintragen |

Eine tägliche Aufgabe hat auf dem Wochenraster nichts verloren — sie bräuchte
dort 26 Häkchen. Deshalb das zweite Blatt, und deshalb ein Test, der genau das
festhält.

Gebaut mit openpyxl, gewandelt von LibreOffice. Beides steckte schon für die
ATR-Mappe im Abbild; der Wandler ist dafür aus `app/atr/pdf.py` nach
`app/dokumente/pdf.py` gezogen und nimmt jetzt einen Namen entgegen.

## Was `compute` hier tut — und was nicht

Nur den Bogen. Maschinen, Aufgaben und Dateizeilen sind gewöhnliches Lesen und
Schreiben und gehen direkt über PostgREST; die Policies hängen an
`production` (lesen) und `production: editor` (schreiben).

Die Dateien liegen im Eimer `wartung`. Beim Löschen einer Maschine räumt die
Kaskade die Zeilen — die Bytes muss die Oberfläche selbst nehmen, und zwar
**vor** der Zeile: eine gelöschte Zeile ohne Datei ist ein Verlust, eine
gelöschte Datei mit Zeile wäre ein Geist. Im Browser nachgemessen: nach dem
Löschen null Zeilen in allen drei Tabellen, null Objekte in `storage.objects`
und null Dateien im Volume.

## Gleichzeitig arbeiten

Maschinen und Wartungsaufgaben gehören zur Phase 1 von ADR-0006: Stammdaten,
Aufgaben und das Löschen gehen nur mit der geladenen `version`. War jemand
anders schneller, sagt die Maske es und lädt den aktuellen Stand. Der
Stammdaten-Entwurf nutzt die Version, mit der er geöffnet wurde, der Titel
einer Aufgabe die Version beim Betreten des Feldes — so greift der Schutz auch,
wenn die Seite inzwischen live nachgeladen hat.

Vor dem Löschen einer Maschine mit Dateien prüft die Oberfläche die Version
**zuerst** — die Bytes im Eimer lassen sich nicht zurückholen. Hat jemand die
Maschine inzwischen geändert, bleiben Dateien und Zeile stehen.

Liste und Maschine bleiben live (`tabelle:maschinen`,
`tabelle:wartungsaufgaben`); an der Maschine steht, wer sie gerade noch offen
hat. Die Dateizeilen haben keine eigene Version.
