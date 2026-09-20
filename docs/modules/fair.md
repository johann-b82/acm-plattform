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

## Zeichnungsliste

Nach Kunde gruppiert (FAI-01), wie im Altsystem: je Kunde ein Block, alphabetisch,
„ohne Kunde“ am Ende (`lib/fair/kunden.ts`). Jeder Block ist einzeln auf- und
zuklappbar — dieselbe `Klappbar` wie in der Personalabteilung, mit Anzahl im Kopf,
`aria-expanded` und nativem Umschalter (per Tastatur bedienbar); zugeklappt wird
der Inhalt versteckt, nicht abgebaut. Über der Liste wählt man zusätzlich einen
Kunden, alle oder „ohne Kunde“; Kunden werden dafür getrimmt verglichen.
Sortieren, Suchen und Blättern macht die gemeinsame `Datentabelle`.

(Die frühere flache Tabelle ist mit der Abnahme-Entscheidung vom 20.09.2026
aufgehoben — die Referenz zeigt einzeln klappbare Kundengruppen.)

## Editor

**Projektkopf.** Über der Zeichnung stehen Kunde, Artikelnr. und P/N
(`kunde`, `artikelnummer`, `teilenummer` der Zeichnung). Wie im Altsystem gibt
es keinen eigenen Bearbeiten-Modus: das Feld speichert beim Verlassen oder mit
Enter, getrimmt, leer heißt kein Wert. Wer nur lesen darf, sieht Text.

**Prüfliste neben der Zeichnung.** Ab Desktop-Breite (`lg`, 1024 px) rechts,
darunter auf schmaleren Bildschirmen. Die Zeichnung bleibt beim Blättern stehen (`sticky`).

**Bubblegröße.** Ein zweites Minus/Plus-Paar nach Einpassen („Bubbles
kleiner“/„Bubbles größer“) skaliert Blase und Nummer aller Ballons gemeinsam —
nicht Feld, Lage oder Zoom. Wie im Altsystem: Schritte von 18 %, Grenzen 0,4 bis
3, gemerkt im Browser für alle Zeichnungen (`lib/fair/ballon-groesse.ts`). Eine
Schriftgröße je Ballon gibt es nicht: die Nummer ist ein fester Anteil der
Blase (`ballonPixel`), sonst passte sie bei kleinen Blasen nicht hinein. Die
PDF-Ausgabe zeichnet mit derselben Größe.

## Reihenfolge und Sortierung

Die Nummer **ist** die Reihenfolge. Verschieben — per Griff (Drag-and-drop)
oder per Pfeil als Tastaturweg — schickt die vollständige neue Folge an
`fair_reihenfolge`; der Ballon behält Feld, Blase und Wert und bekommt nur eine
andere Nummer, auf der Zeichnung wie in CSV und PDF.

Die Prüfliste sortiert und sucht wie jede Tabelle (TAB-02/03). Das ist der
Sonderfall: Verschieben geht nur, solange sie die Nummernfolge zeigt — ohne
Suche und unsortiert oder nach Nr aufsteigend. Nach Wert sortiert hieße „nach
oben“ etwas anderes als die Nummer davor, und eine manuelle Reihenfolge würde
unsichtbar verändert. Griffe und Pfeile sind dann gesperrt, ein Hinweis sagt
warum. Gezogen wird innerhalb der sichtbaren Seite; über Seitengrenzen tragen
die Pfeile.

## OCR je Zeile

Der Kreis-Pfeil in jeder Zeile („OCR für diese Zeile neu starten“) liest das
gespeicherte Feld des Ballons neu, wie `reocrBalloon` im Altsystem: frisch aus
der Originaldatei gerastert, lange Kante 1400 px, unabhängig vom Zoom; mit
weißem Rand in allen vier Lagen, die beste Lesung gewinnt
(`lib/fair/ocr.ts`, `[id]/raster.ts`).

Das Ergebnis geht nur in diese Zeile. Ein leeres Feld wird direkt gefüllt;
steht schon ein **anderer** Wert darin, fragt ein Dialog vor dem Ersetzen —
das Altsystem überschreibt still, hier war ausdrücklich verlangt, getippte
Werte nicht ungefragt zu ersetzen. Nichts erkannt oder Fehler: Meldung, der
Wert bleibt.

**Alles vom eigenen Server.** tesseract.js lädt Arbeiter, Kern und Sprachdaten
sonst von jsdelivr. Hier gelten feste Pfade unter `/tesseract`:

| Datei | Herkunft |
|---|---|
| `worker.min.js`, `tesseract-core-*-lstm.wasm.js` | `scripts/tesseract-dateien.mjs` kopiert sie vor `dev` und `build` aus `node_modules` (nicht eingecheckt) |
| `lang/deu.traineddata.gz`, `lang/eng.traineddata.gz` | eingecheckt (tessdata 4.0.0, dieselben Dateien wie im Altsystem) — es gibt sie in keinem installierten Paket, und ein Abruf beim Bauen bräuchte Internet |

Der Arbeiter startet erst beim ersten OCR-Klick, nicht beim Öffnen: wer nur
ansieht, lädt die rund 18 MB Sprachdaten nicht. Beim Setzen eines neuen Ballons
liest die Plattform — anders als das Altsystem — noch nicht automatisch vor;
nach dem Setzen füllt der Knopf in der Zeile das leere Feld.

## Ausgabe

Die Prüfliste geht als Tabulatortext in die Zwischenablage (direkt in Excel
einfügbar) oder als CSV mit Semikolon und BOM — was deutsches Excel beim
Doppelklick erwartet.

**PDF.** Wie „PDF exportieren“ im Altsystem: jede Seite der Zeichnung in ihrer
Größe und in der Drehung der Ansicht, die Ballons als Vektoren darauf. Die
Nummern stehen aufrecht. Dazu kommt eine Prüfliste mit Projektkopf, damit das
PDF allein als Prüfbericht taugt. Anders als im Altsystem (`pdf-lib`, Vektorseite
eingebettet) wird die Zeichnung mit lange Kante 3000 px gerastert — `jspdf` kann
keine PDF-Seiten einbetten, und eine zweite PDF-Bibliothek nur dafür lohnt
nicht. Die Erzeugung ist eine reine Funktion (`lib/fair/pdf.ts`) mit Prüfungen.
