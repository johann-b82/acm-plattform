# ATR — Lieferschein zum ATR-Dokument

Aus einem Diehl-Lieferschein entsteht ein ATR-Dokument: Excel, PDF und ein
Container-Etikett. Dazu braucht es drei Dinge — den Lieferschein, den
**Teilekatalog** (was ein Teil heißt, wiegt und zu welcher Zeichnung es gehört)
und die **Vorlage** (Kopfdaten und Gerüstdatei je Programm).

Der Port läuft in mehreren Schritten. Dieses Dokument wächst mit; was noch
fehlt, steht unten.

| Schritt | Stand |
|---|---|
| Teilekatalog und Vorlage | steht (Migration `0022_atr_katalog`) |
| Lieferschein einlesen und abgleichen | steht (Migration `0023_atr_lieferungen`) |
| Erzeugung von Excel, PDF und Etikett | offen |
| Scan eines Eingangsordners | offen |

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
| Katalog und Vorlagen sehen | ein `atr`-Recht |
| Pflegen, einlesen, Gerüst hinterlegen | `atr: editor` |

Im Altprojekt hängen ATR und FAIR an einer gemeinsamen Zwischenrolle „QS", weil
es nur Admin und Viewer gab. Mit App-Rechten entfällt sie; ATR und FAIR sind
getrennt vergebbar.

## Der Lieferschein

Ein Diehl-Lieferschein wird eingelesen, gegen den Katalog abgeglichen und als
**Entwurf** abgelegt. Nach der Durchsicht wird er freigegeben.

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

## Freigegeben ist fest

Nach der Freigabe weist ein Trigger jede Änderung an den Positionen ab —
Einfügen, Ändern und Löschen. Das hängt an der Tabelle, nicht an der
Oberfläche: über PostgREST gäbe es sonst einen Weg daran vorbei.

Zwei Dinge bleiben absichtlich möglich:

- **Die Freigabe zurücknehmen.** Sonst wäre ein Tippfehler endgültig.
- **Kopfdaten nachtragen.** Containernummer, Wiegedatum und QS-Unterschrift
  entstehen oft erst nach der Freigabe der Positionen.

## Was noch kommt

**Erzeugung.** Excel aus der Gerüstdatei, PDF daraus, Container-Etikett als
Word-Dokument.

**Eingangsordner.** Im Altprojekt scannt ein Scheduler-Job einen SMB-Ordner.
Hier stößt `pg_cron` über `pg_net` eine Route in `compute` an — der Dienst
bleibt zwischen den Aufrufen zustandslos. Dazu gehört die Ziel-Allowlist auf
Subnetze, die im Altprojekt als Befund 16 offen blieb, weil das System dort
kurz vor der Ablösung stand.
