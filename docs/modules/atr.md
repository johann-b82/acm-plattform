# ATR — Lieferschein zum ATR-Dokument

Aus einem Diehl-Lieferschein entsteht ein ATR-Dokument: Excel, PDF und ein
Container-Etikett. Dazu braucht es drei Dinge — den Lieferschein, den
**Teilekatalog** (was ein Teil heißt, wiegt und zu welcher Zeichnung es gehört)
und die **Vorlage** (Kopfdaten und Gerüstdatei je Programm).

Der Port lief in vier Schritten:

| Schritt | Stand |
|---|---|
| Teilekatalog und Vorlage | steht (Migration `0022_atr_katalog`) |
| Lieferschein einlesen und abgleichen | steht (Migration `0023_atr_lieferungen`) |
| Erzeugung von Excel, PDF und Etikett | steht (Migration `0024_atr_ausgaben`) |
| Scan eines Eingangsordners | steht (Migration `0025_atr_scan`) |

## Der Schlüssel ist die Teilenummer ohne Beiwerk

Auf dem Lieferschein steht sie mal mit Präfix, mal mit Bindestrichen; im
Katalog wieder anders. Verglichen werden deshalb nur die Ziffern:
`VR-1234-56`, `VR 1234 56` und `1234/56` sind dasselbe Teil.

Im Altprojekt macht das eine Python-Funktion (`norm_partno`). Hier ist es eine
**erzeugte Spalte**: sie wird nie geschrieben, sondern folgt der Teilenummer.
Damit kann sie nicht auseinanderlaufen, und niemand kann am Katalog vorbei eine
Zeile mit falsch normierter Nummer einfügen — auch nicht über PostgREST.

Der Eindeutigkeitsindex darauf ist **teilweise**: eine Teilenummer ganz ohne
Ziffern ergibt keine normierte Nummer, fällt durch den Index und blockiert
damit keine andere.

Gesucht wird über beides. Wer Ziffern eintippt, findet auch eine anders
geschriebene Nummer — genau dafür ist die Spalte da.

## Die Referenzmappe

Ein ausgefülltes ATR-Formular in Excel. Kopfdaten stehen in festen Zellen
(`D1`–`D8`, `G3`, `G4`, `G8`, `F12`), ab Zeile 14 folgen die Teile,
unterbrochen von Abschnittsüberschriften in Spalte A. Ein Teil erkennt man an
einer Nummer mit Präfix `VR` in Spalte C; beim Summenblock hört das Lesen auf.

Diese Adressen sind aus dem Altprojekt übernommen und an einer echten Vorlage
gewachsen. **Sie sind der Grund, vor dem ersten echten Import ein
Referenzblatt durchlaufen zu lassen**: verschiebt der Kunde eine Zeile, stehen
die Kopfdaten am falschen Ort. Deshalb prüft der Parser zuerst Zeile 13 auf die
erwartete Tabellenüberschrift und scheitert laut, statt still falsche Werte zu
übernehmen. Ebenso bei mehr als einem sichtbaren Blatt.

Der Import ist der einzige Weg über `compute` — eine Excel-Datei mit festen
Zellen ist weder in SQL noch über PostgREST zu lesen. Er läuft in einem Thread,
weil openpyxl blockiert.

**Erneut einlesen korrigiert, statt zu verdoppeln.** Der Konflikt geht auf die
normierte Nummer; eine neuere Mappe darf die ältere überschreiben, ohne dass
jemand vorher aufräumt. Die Gerüstdatei bleibt dabei, wo sie ist — sie wird
getrennt hochgeladen und hat mit den Kopfdaten der Mappe nichts zu tun.

Ein Gewicht, das sich nicht lesen lässt (`ca. 0,4`), wird als Hinweis gemeldet
und nicht still zu Null.

## Rechte

| | Recht |
|---|---|
| Katalog, Vorlagen und das Scan-Ziel sehen | ein `atr`-Recht |
| Pflegen, einlesen, Gerüst hinterlegen, den Eingang durchsehen | `atr: editor` |
| Eintragen, **worauf** der Scan zeigt | `platform: admin` (unter `/einstellungen#atr`) |

Im Altprojekt hängen ATR und FAIR an einer gemeinsamen Zwischenrolle „QS", weil
es nur Admin und Viewer gab. Mit App-Rechten entfällt sie; ATR und FAIR sind
getrennt vergebbar.

## Der Lieferschein

Ein Diehl-Lieferschein wird eingelesen, gegen den Katalog abgeglichen und als
**Entwurf** abgelegt. Nach der Durchsicht werden die Dokumente erzeugt.

Der Parser ist zweigeteilt, und das ist der Grund, warum er prüfbar ist:
`pdftotext -layout` holt den Text, die Auswertung ist eine reine Funktion.
Zwölf Prüfungen laufen deshalb gegen Text und brauchen kein PDF.

Der Spaltenerhalt (`-layout`) ist nicht Beiwerk: eine Positionszeile wird an
vier Feldern in fester Reihenfolge erkannt, und eine aus der rechten Spalte
angeklebte Randnotiz („Freigabe durch AV") wird am ersten Lauf von drei
Leerzeichen abgeschnitten. Eine Textextraktion ohne Layout liefert eine andere
Reihenfolge und damit andere Ergebnisse — deshalb `poppler-utils` im Abbild und
nicht eine reine Python-Bibliothek.

Erkannt werden dabei:

| Zeile im Lieferschein | wird zu |
|---|---|
| `Nr. 704511` / `Datum 14.08.2026` | Lieferschein-Nummer und Datum |
| `10  4711  2  Stk` | Position, Lieferantennummer, Menge |
| die Zeile danach | Bezeichnung (Randnotiz abgeschnitten) |
| `Ihre Nr. VR-1234-56` | Teilenummer |
| `Auftrag Nr. 880231 / 12` | BA-Auftrag und Bestellposition |
| `Bestelldaten 4500123/CCRC/MSN0815/2-Bett/A350` | Bestellnummer, Bereich, MSN, Bettvariante, Programm |
| `Seriennr. A…3376, A…3377` | eine Nummer je geliefertem Stück |

Die Merkmale in den Bestelldaten stehen in beliebiger Reihenfolge; erkannt wird
jedes für sich, und ein unbekanntes stört die anderen nicht.

**Warum das Programm so heißt, steht in der Zeile.** `programm_grund` hält
fest, ob A350 oder A380 aus den Bestelldaten kam oder ob gar kein Merkmal da
war. Im Altprojekt ist das ein stiller Zweig, und wer die Ausgabe prüft, sieht
nur das Ergebnis.

**Ein doppelter Lieferschein wird einmal gezählt.** Manchmal stecken zwei
Kopien in derselben PDF; der Fließtext liefert dann jede Position doppelt.
Erkannt an (Position, Teilenummer, Auftrag, Bestellposition), gemeldet als
Hinweis.

## Eine Position steht auf eigenen Füßen

Was der Katalog liefert, wird in die Position **kopiert**, nicht verlinkt. Der
Fremdschlüssel auf das Katalogteil ist nur der Hinweis, woher die Werte
stammen, und steht auf `on delete set null`.

Der Grund: der Katalog ändert sich, ein freigegebener ATR nicht. Wird ein Teil
später umbenannt oder neu gewogen, bleibt die Lieferung, wie sie freigegeben
wurde. Ein Test räumt den Katalog ab und prüft, dass Bezeichnung und Gewicht
in der Position stehen bleiben.

## Die Zustände sind die des Altsystems

`entwurf` → `erzeugt` → `abgelegt` (Migration `0048_atr_abgleich`, Befund
ATR-09). Ein Entwurf wartet auf Durchsicht; mit den Dokumenten ist die
Lieferung `erzeugt` (Altsystem `generated`); legt der automatische Scan sie im
Ausgangsordner ab, ist sie `abgelegt` (`delivered`). Eine Freigabe gibt es
nicht, und kein Zustand sperrt die Positionen — Seriennummern und Gewichte
werden auch nach der Erzeugung nachgetragen und die Dokumente dann neu erzeugt.
So macht es das Altprojekt (`services/atr_deliver.py`).

Bis 0048 kannte die neue Tabelle nur `entwurf`/`freigegeben`, und ein Trigger
weis Änderungen an den Positionen einer freigegebenen Lieferung ab. Die
Übernahme legte `generated` deshalb auf `entwurf` — die erzeugten Dokumente
kamen damals nicht mit. Seit sie nachgeholt sind (`uebernahme/dateien.py`),
stimmt `erzeugt` wieder; 0048 korrigiert die schon übernommenen Zeilen aus dem
Erzeugungsdatum (`erzeugt_am gesetzt ⇒ erzeugt`), niemals pauschal. Ein
Statuswechsel zählt nicht als Änderung — er zieht `geaendert_am` nicht hoch,
sonst stünde jede gerade erzeugte Mappe als „danach geändert" da.

## Die Erzeugung

Drei Ausgaben je Lieferung: die ATR-Mappe, das PDF daraus und das
Container-Etikett. Sie liegen im Eimer `atr` unter `erzeugt/<lieferung>/`; die
Zeile hält nur die Pfade. Im Altprojekt stecken alle drei als `bytea` in der
Zeile.

### Die Vorlage ist der Rahmen

Kopfblock, Tabellenüberschrift, Summenzeile und Zertifizierungsblock bleiben,
wie sie sind — samt Formaten, verbundenen Zellen und Druckkopfzeile. Ersetzt
wird nur der Bereich zwischen Tabellenüberschrift und Summenzeile.

**Zeilen werden über Beschriftungen gefunden, nicht über Nummern.** An den
echten Vorlagen aus der Produktion nachgesehen:

| | A350 | A380 |
|---|---|---|
| `PO Pos` | Zeile 13 | Zeile 10 |
| `Total weight` | Zeile 80 | Zeile 14 |

Feste Zeilennummern gingen bei der zweiten Vorlage sofort daneben. Dieselbe
Suche gilt für „Supplier:", „Manufacturing Process Reference",
„Purchase Order No", „MSN:" und „Weighing date"; die Satzbezeichnung steht als
Banner direkt über der Wiegezeile.

### Was beim Bauen aufgefallen ist

Vier Dinge, jedes an einer erzeugten Datei nachgemessen:

**Die Programmangabe steht in drei Schreibweisen.** Die Referenzmappe sagt
`A350 XWB` und `A380 - 800`, der Lieferschein `A350`. Als Schlüssel taugt nur
die Familie — sonst fände eine Lieferung ihre Vorlage nie
(`programmfamilie()`).

**Die Kopfdatenspalten der Vorlage sind in der Produktion leer.** Der Kopf
steckt in der Gerüstdatei selbst; die Erzeugung überschreibt deshalb nur die
Felder, die aus der Lieferung kommen, und lässt den Rest stehen. Die Spalten
in `atr_vorlagen` machen den Kopf sichtbar und pflegbar, sind aber nicht die
Quelle.

**openpyxl schreibt Zeilenumbrüche der Druckkopfzeile als `_x000a_`.** Excel
versteht das noch, LibreOffice nicht — im PDF stand wörtlich
„…Issue: 01_x000a_Date: 10.09.2026" quer über der Seite. Die Nachbehandlung
setzt sie auf `&#10;` zurück. Das hing hier einmal am Logo-Zweig; ein Gerüst
ohne Kopfbild bekam dann weiterhin die kaputte Kopfzeile — ein Test hält
beides fest.

**`=TODAY()` in der Vorlage wird amerikanisch gesetzt.** Im PDF stand
„9/10/2026". Wiege- und Prüfdatum werden deshalb immer geschrieben, auch wenn
sie nicht gesetzt sind: ein heute erzeugtes Dokument darf heute tragen, es
muss nur deutsch lesbar sein.

### Das Kopfbild

openpyxl behält den Kopfzeilen-Code `&G`, wirft die Bildteile beim Speichern
aber weg. Sie kommen aus der Vorlage zurück, und die Dateien des Ergebnisses
werden dabei **ergänzt**, nicht durch die der Vorlage ersetzt: openpyxl
schreibt eine andere Menge von Teilen als Excel (etwa ohne
`sharedStrings.xml`), und ein `[Content_Types].xml` aus der Vorlage verspräche
Teile, die es nicht gibt — die Datei ließe sich nicht mehr öffnen. Auch das
ist einmal passiert.

### Das PDF

`soffice --headless --convert-to pdf`, ein Lauf zur Zeit (LibreOffice verträgt
keine zwei im selben Profil). Im Abbild steckt bewusst nur `libreoffice-calc`,
ohne Writer, Impress und Java: 207 MB statt weit über einem halben Gigabyte.

**Ein Unterschied zum Altprojekt:** im PDF fehlt das Logo in der Kopfzeile.
LibreOffice rendert die VML-Grafik der Druckkopfzeile nicht — nachgemessen.
Das Altprojekt löst das, indem es LibreOffice über **UNO** fernsteuert und das
Logo als schwebende Form in das Kopfband setzt (`atr_uno_header.py`). Das
kostet `python3-uno` im Abbild und ein zweites Verfahren neben dem einfachen
Umwandeln. Die Mappe selbst trägt das Logo; das PDF nicht. Wer es dort braucht,
holt den UNO-Weg nach.

Das PDF ist der einzige Schritt, der scheitern darf, ohne den Rest
mitzunehmen: LibreOffice ist ein fremder Prozess. Mappe und Etikett stehen
dann trotzdem, und ein Hinweis sagt, was fehlt.

### Frisch oder veraltet

`erzeugt_am` sagt, wann die Dateien entstanden. Steht dort ein Zeitpunkt vor
`geaendert_am`, ist die Lieferung seither angefasst worden — die Oberfläche
sagt das, statt es zu verschweigen.

Damit das trägt, zählt das Ablegen der Dateien nicht als Änderung: ohne diese
Unterscheidung zöge derselbe Schreibvorgang, der `erzeugt_am` setzt, auch
`geaendert_am` hoch, und jede frisch erzeugte Mappe wäre sofort „veraltet".
Die Lieferungen haben dafür eine eigene Triggerfunktion — die gemeinsame hängt
auch an `atr_positionen`, und plpgsql löst die Feldverweise einer Bedingung
vorab auf.

## Der Eingangsordner

Ein Lieferschein landet als PDF in einem Ordner auf dem Dateiserver. Der Scan
liest ihn, legt die Lieferung an und schiebt die Datei ins Archiv — im Modus
`automatisch` erzeugt er dazu Mappe, PDF und Etikett und legt sie im Ausgang
ab. Was er tut, steht in der einzeiligen Tabelle `atr_scan`; die Maske dafür
sitzt unter `/einstellungen#atr`, zusammen mit den Vorlagen — dort gehört sie
hin, denn sie gilt für alle. Den Eingang von Hand durchsehen kann dagegen jede
ATR-Bearbeiterin, mit dem Knopf bei den Lieferungen: einen liegen gebliebenen
Lieferschein löst aus, wer mit Lieferungen arbeitet.

**Der Takt kommt aus der Datenbank, nicht aus dem Dienst.** Im Altprojekt hielt
ein Scheduler-Thread in der API den Zeitplan; ein Neustart hätte ihn mitgenommen.
Der Takt ist frei in Sekunden einstellbar, `0 = aus` (Befund SET-14, Migration
`0048`) — der feste Zehn-Minuten-Plan werktags 5–19 Uhr ist weg. `pg_cron`
klopft alle zehn Sekunden über `pg_net` an; ob wirklich ein Lauf dran ist,
entscheidet `atr_scan_faellig()` mit **einem** Schreibvorgang auf
`angestossen_am`: zwei Anstöße zugleich können ihn nicht beide auslösen, und
ein halber Takt Spielraum verhindert, dass aus 60 Sekunden durch
Laufzeitschwankung 70 werden. `compute` bleibt zwischen den Aufrufen zustandslos.

**Nie zwei Läufe zugleich.** `lauf_seit` steht in der Datenbank, nicht im
Prozess: der Dienst setzt es beim Betreten und löscht es am Ende (`belegen()`
/ `freigeben()`), ein zweiter Lauf — geplant oder von Hand — bekommt den Ordner
nicht. Ein Stempel, der älter als eine Stunde ist, gehört zu einem
abgestürzten Lauf und hält nicht ewig auf. So darf `compute` mehrfach laufen,
ohne dieselbe Datei doppelt zu verarbeiten.

**Der geplante Lauf hängt nicht am Router-Gate.** Ein SQL-Job hat kein
Nutzertoken. Statt dessen ein gemeinsames Geheimnis: `ATR_SCAN_TOKEN` steht in
der Umgebung von `compute` und als `acm.atr_scan_token` in der Datenbank, und
die Route vergleicht mit `hmac.compare_digest`. Steht das Intervall auf `0`,
schickt die Datenbank gar nichts erst los — der Schalter wirkt vor dem Netz.

### Wohin der Dienst greifen darf

Das Ziel steht in der Datenbank, die Erlaubnis nicht. `ATR_SMB_ERLAUBT` gibt
Namen und Subnetze vor; `pruefe_ziel()` löst den eingetragenen Rechner auf und
prüft **jede** zurückgegebene Adresse gegen diese Liste. Damit ist der Befund 16
aus dem Altprojekt geschlossen: dort durfte ein Admin ein beliebiges Ziel im
Netz eintragen, und der Dienst meldete sich mit dem Dienstkonto dort an.

Das Passwort des Dienstkontos trägt die Plattform-Verwaltung über ein
geschütztes Feld ein (Befund SET-13): verschlüsselt in `geheimnisse` unter
`atr_smb_passwort`, mit dem `GEHEIM_SCHLUESSEL` aus der Umgebung — dasselbe
Fernet-Verfahren wie bei Personio und den Sensoren. Es kommt nie im Klartext
zurück; die Maske erfährt nur, ob eines hinterlegt ist und woher. Ein leeres
Feld behält das gespeicherte. `ATR_SMB_PASSWORT` in der Umgebung gilt weiter
als Rückfall — die Datenbank geht vor, damit ein einmal eingetragenes Passwort
sticht, ohne dass jemand an den Server muss (`GET`/`PUT /api/atr/scan/passwort`,
nur `platform: admin`). Deshalb auch die zwei Rechtestufen oben — durchsehen
darf, wer ATR bearbeitet; **worauf** gezeigt und **womit** angemeldet wird,
setzt nur die Plattform-Verwaltung.

### Was ein Lauf aushält

- **Archiviert wird zuletzt.** Erst lesen, dann die Lieferung anlegen, dann
  verschieben. Bricht etwas dazwischen ab, liegt die Datei noch im Eingang und
  der nächste Lauf nimmt sie wieder mit — lieber zweimal gelesen als verloren.
- **Eine kaputte Datei blockiert den Ordner nicht.** Der Fehler wird je Datei
  eingefangen und als Hinweis gemeldet, die Datei bleibt liegen, der Rest läuft
  weiter.
- **Ein wegbrechender Dateiserver hält den Lauf an.** Bei einem
  `DateiserverFehler` bricht die Schleife ab, statt sich an jeder verbliebenen
  Datei erneut die Zähne auszubeißen.
- **Gleicher Name, zweimal.** Liegt der Dateiname im Archiv schon, schreibt der
  Lauf `… (1).pdf` statt zu überschreiben. Das ist auf dem echten Ordner
  passiert und war richtig so.

Vor Ort geprüft am 10.09.2026 gegen `\\acm_file\Dateiablage\0900 - EDV\Test_ATR`:
ein echter Diehl-Lieferschein, 8 Positionen, alle 8 im Katalog gefunden, Mappe
mit `Total weight 4,63` — und die Datei danach im Archiv.

## Gleichzeitig arbeiten

Lieferungen und Positionen sind Tabellen der Phase 1 von ADR-0006. Jede Zeile
trägt eine `version`, die die Datenbank bei jeder Änderung hochzählt — auch
wenn der Scan, die Erzeugung oder die Containerbeschriftung in `compute`
schreiben. Die Oberfläche speichert und löscht nur mit der geladenen Version;
war jemand anders schneller, sagt sie es und lädt den aktuellen Stand.

Liste und Durchsicht bleiben live (`tabelle:atr_lieferungen`,
`tabelle:atr_positionen`), und die Durchsicht zeigt, wer dieselbe Lieferung
gerade offen hat.

**Positionen speichern mit der Version beim Betreten des Feldes.** Eine
Position speichert beim Verlassen jedes Feldes. Gespeichert wird mit der
Version, die sie beim Betreten hatte — hat jemand anders sie inzwischen
geändert, fällt das auf, auch wenn die Liste schon live nachgeladen hat. Wer
von Feld zu Feld springt, ist schneller als das Neuladen: die Änderungen einer
Lieferung laufen deshalb hintereinander, und was die eigene vorige
Speicherung aus der Version gemacht hat, gilt als Fortsetzung — kein Konflikt
mit sich selbst. Ändert ein anderer einen Wert, steht er im Feld, sobald es
niemand bearbeitet.

Die Kopfdaten sind ein Entwurf mit „Speichern“. Ändert jemand anders die
Lieferung, während der Entwurf offen ist, setzt die Maske ihn auf den neuen
Stand zurück — sie hängt am Änderungsstempel.
