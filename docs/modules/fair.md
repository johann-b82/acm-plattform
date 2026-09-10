# FAIR — Erstmusterprüfung

Eine Zeichnung wird hochgeladen, und zu jedem zu prüfenden Maß setzt man einen
nummerierten Ballon. Die Nummern sind das Ergebnis: sie stehen später im
Prüfbericht neben den gemessenen Werten.

## Wie ein Ballon entsteht

Ein Feld über das Maß ziehen, dann klicken, wo die Blase sitzen soll. Die
Pfeilspitze wird nicht gespeichert — sie ergibt sich aus der Mitte des Felds
und liegt knapp außerhalb, damit sie den Wert nicht verdeckt.

Ein Klick ohne Ziehen erzeugt nichts: unterhalb einer Mindestgröße bricht der
Vorgang ab, sonst entstünde bei jedem versehentlichen Klick ein Ballon mit
unsichtbarem Feld.

## Die Nummerierung gehört der Datenbank

Im Altprojekt rechnet der Router sie aus: er sucht die höchste Nummer, zählt
hoch, und schreibt nach einem Löschen alle Ballons in **zwei Durchgängen** um —
mit einem Zwischenwert oberhalb einer Million, weil die Eindeutigkeit sonst
mitten im Umschreiben bricht.

Hier ist die Bedingung `deferrable initially deferred`: sie wird erst beim
Commit geprüft, ein einziges `update` genügt. Und weil alles an Triggern hängt,
gibt es keinen Weg, auf dem Lücken entstehen — auch nicht über PostgREST, das
an keinem Router vorbeikommt:

| Vorgang | Wer macht es |
|---|---|
| Neue Nummer | Trigger `fair_ballon_nummer` vor dem Einfügen |
| Lücke nach dem Löschen | Trigger `fair_luecke_schliessen` nach dem Löschen |
| Umsortieren | Funktion `fair_reihenfolge(zeichnung, ids)` |

`fair_reihenfolge` verlangt die Kennungen **aller** Ballons der Zeichnung. Wäre
die Liste unvollständig, hätten die Übrigen danach womöglich doppelte Nummern —
lieber gar nichts ändern als eine halbe Reihenfolge.

Beim Anlegen sperrt der Trigger kurz die Zeichnung (`for update`). Ohne das
bekämen zwei gleichzeitig gesetzte Ballons dieselbe Nummer, und der zweite
Commit schlüge fehl.

## Koordinaten

Alles liegt als Bruchteil [0,1] der natürlichen Seitengröße vor, dazu die
Seitennummer. Damit hängt ein Ballon nicht an der Auflösung, an der Zoomstufe
oder daran, wie breit das Fenster gerade war.

Die Drehung ist reine Ansicht. Ballons liegen immer in kanonischen Koordinaten,
sonst wäre ein Drehen der Ansicht eine Datenänderung — und jede gedrehte
Ansicht eine andere Wahrheit.

Zoom und Verschieben liegen als **eine** Transformation über Zeichnung und
Ballonebene gemeinsam. Dadurch stimmen die Koordinaten von selbst, und die
PDF-Leinwand muss beim Zoomen nicht neu gerastert werden; nur ihre Auflösung
wird angehoben, damit Maßtext scharf bleibt.

Die Rechnung steht in `lib/fair/geometrie.ts`, ohne React und ohne DOM, mit 18
Prüfungen — darunter die beiden, auf die es ankommt: die Umrechnung kehrt sich
selbst um, und beim Zoomen bleibt der Punkt unter dem Zeiger liegen.

## Die pdf.js-Falle

Zwei Dinge müssen zusammenpassen, sonst bleibt die Zeichnung leer und die
Meldung sagt nur „ließ sich nicht laden":

1. Die Arbeiter-Einstellung läuft über `react-pdf`s eigenen `pdfjs`-Export,
   nicht über einen blanken `pdfjs-dist`-Import — sonst setzt man sie auf einer
   zweiten Instanz des Moduls.
2. `pdfjs-dist` oben im Projekt muss **genau** die Fassung sein, die react-pdf
   verlangt (10.5.0 hängt an 5.4.296). Steht dort eine andere, legt npm die
   verlangte daneben, und der Arbeiter kommt aus einer anderen Hauptversion als
   die Bibliothek. Deshalb die feste Fassung **und** der `overrides`-Eintrag in
   `package.json`.

Genau darüber ist dieser Port gestolpert: mit `pdfjs-dist@6` installiert lud
keine Zeichnung, ohne dass ein Fehler gesagt hätte, warum.

## Rechte

| | Recht |
|---|---|
| Zeichnungen und Ballons sehen | ein `fair`-Recht |
| Hochladen, ballonieren, löschen | `fair: editor` |

Ballons erben die Sichtbarkeit ihrer Zeichnung (`exists (select 1 from ...)`),
statt die Bedingung zu wiederholen.

Im Altprojekt hängen ATR und FAIR an einer gemeinsamen Zwischenrolle „QS", weil
es nur Admin und Viewer gab. Mit App-Rechten entfällt sie.

## Ausgabe

Die Prüfliste geht als Tabulatortext in die Zwischenablage (direkt in Excel
einfügbar) oder als CSV mit Semikolon und BOM — was deutsches Excel beim
Doppelklick erwartet.

## Was fehlt

**OCR.** Das Altprojekt liest den Wert im markierten Feld mit `tesseract.js`
und trägt ihn vor. Das ist bequem, kostet aber 47 MB mitgelieferte Laufzeit im
Abbild und einen Download von einem fremden Host im Build — für einen Stack,
der im LAN ohne Internet laufen soll, eine eigene Entscheidung. Bis dahin wird
der Wert in der Prüfliste getippt.

**PDF-Ausgabe mit Ballons.** Das Altprojekt kann die ballonierte Zeichnung als
PDF ausgeben. Der Weg dafür steht bereit — die Ballonebene ist ein SVG in
Seitenkoordinaten, dieselbe Rechnung wie am Bildschirm.
