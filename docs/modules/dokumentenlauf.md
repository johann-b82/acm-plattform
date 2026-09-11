# Dokumentenlauf — Blatt erzeugen, aushändigen, zurücknehmen, prüfen

Zwei Formblätter gehen im Haus denselben Weg: der Einarbeitungsplan und der
Schulungsnachweis. Sie werden gedruckt, ausgehändigt, von Hand ausgefüllt,
unterschrieben zurückgegeben und abgeheftet.

| Teil | Ort |
|---|---|
| Die Liste und der Weg | `/hr/dokumente` (Recht `hr`, Pflege `hr: editor`) |
| Anlegen, Scan, Urteil | `compute`, `app/routers/dokumente.py` |
| QR und Seitengeometrie | `app/dokumente/qr.py` |
| Prüfung des Scans | `app/dokumente/pruefung.py` |
| Schema und Eimer | Migration `0035_dokumentenlauf` |

## Warum überhaupt ein Vorgang

Ein heruntergeladenes PDF ist weg. Niemand weiß, ob es übergeben wurde, ob es
zurückkam, ob es vollständig ausgefüllt ist. Genau das fragt das Audit.

Der Vorgang hält es fest, und der QR-Code auf dem Blatt ordnet einen später
eingescannten Bogen wieder zu — unabhängig von Dateiname und Schreibweise des
Namens.

## Eine Tabelle, nicht zwei

Im Altprojekt gibt es `einarbeitung_dokument` **und** `schulung_dokument` mit
demselben Inhalt, dazu zwei Sätze Routen. Hier ist es eine Tabelle mit einer
Spalte `art`: der Weg ist derselbe, die Prüfung ist dieselbe, der QR ist
derselbe. Was sich unterscheidet, ist der Inhalt des Blattes — und der steht
ohnehin als Abschrift in `inhalt`.

**Die Abschrift ist Absicht.** Name, Funktion und Inhalt stehen als Kopie in
der Zeile. Ändert sich später der Schulungskatalog oder die Abteilung der
Person, dokumentiert der Vorgang weiter, was damals auf dem Blatt stand. Ein
Verweis täte das nicht.

## Der Weg ist eine Reihenfolge

    erstellt → übergeben → zurück → geprüft

Immer genau ein Schritt, nie zwei, nie rückwärts. Ein Blatt lässt sich nicht
prüfen, das nie jemand bekommen hat. Zwei Bedingungen in der Datenbank halten
das fest — eine für die Reihenfolge der Zeitstempel, eine dafür, dass der
Status dasselbe sagt wie sie.

Das Weiterschalten schreibt zusätzlich mit `where status = <alter Stand>`: zwei
gleichzeitige Klicks sollen nicht zwei Stationen überspringen.

Ein Scan setzt den Weg voraus. Fehlen die Stationen davor, werden sie beim
Hochladen nachgetragen — das Blatt ist ja nachweislich draußen gewesen.

## Was auf dem Papier steht

**Ein QR-Code** oben rechts mit der Vorgangskennung. Sie besteht aus einem
Alphabet ohne verwechselbare Zeichen (kein 0/O, kein 1/I/l): notfalls wird sie
abgetippt.

**Zwei Passermarken**, kleine schwarze Quadrate in der leeren linken
Randspalte, oben und unten. Mit dem QR oben rechts ergeben sich drei über die
Seite verteilte Referenzpunkte.

Warum drei und nicht einer: aus dem kleinen QR allein lässt sich nur eine
gleichmäßige Ähnlichkeit schätzen — Verschiebung, Drehung, **ein** Maßstab.
Das reicht nicht, wie sich beim Bauen zeigte (siehe unten).

## Die Prüfung sieht *ob*, nicht *was*

1. Scan rastern (PDF über `pdftoppm`, Bild direkt).
2. QR lesen: Kennung und vier Ecken.
3. Aus QR und Marken die Abbildung Blatt → Scan schätzen.
4. Jedes Feldrechteck abbilden und dort die dunklen Pixel zählen.

Keine Zeichenerkennung. Eine Unterschrift ist für dieses Verfahren dasselbe wie
ein Datum: dunkle Pixel, wo vorher keine waren. **Deshalb ist das Urteil von
Hand überstimmbar**, und die Maske bietet es an — wer das Blatt in der Hand
hatte, weiß es besser.

**Gegen das Blanko gerechnet.** Rahmen und Unterstriche des Formulars sind
selbst Tinte; ohne Abzug gälte jedes Feld mit einer Linie darunter als
ausgefüllt. Das leere Blatt wird deshalb mitgerendert und feldweise abgezogen.
Nachgemessen trennt das sauber: leeres Blatt 0,0 % Netto-Tinte, beschriebene
Felder 10–18 %, Schwelle 2 %.

## Drei Fallen, alle beim Prüfen am gerenderten Blatt gefunden

Keine davon wäre ohne den Test durch die ganze Kette aufgefallen — die
Feldrechtecke entstehen aus einem *Modell* der Seitengeometrie, und ob das
Modell stimmt, zeigt erst das gerenderte Blatt.

**1. Die Passermarken wurden nie gefunden.** Der übernommene Weg sucht sie an
einer Stelle, die er aus dem QR vorhersagt. Die Vorhersage war am Blattfuß um
mehrere Zentimeter daneben, die Ausrichtung fiel auf die QR-Ähnlichkeit zurück
— und die Rechtecke landeten eine Zeile zu hoch, nämlich auf dem Tabellenkopf.
Jetzt werden sie direkt gesucht: im linken Randstreifen stehen sie allein, es
sind die einzigen vollflächig schwarzen Quadrate dort. Die Vorhersage bleibt
als Rückfall für einen schiefen Scan.

**2. Die Abbildung ist nicht gleichmäßig.** Gemessen: waagerecht Faktor 4,16
Scanpixel je Punkt, senkrecht 3,30. LibreOffice staucht die Seite in der Höhe
anders als in der Breite. Eine Ähnlichkeit kann das nicht ausdrücken, eine
Affine aus drei Punkten schon — deshalb Punkt 1.

**3. Zeilen ohne gesetzte Höhe.** Die Rechnung summiert Zeilenhöhen. Bleibt
eine ungesetzt, entscheidet LibreOffice selbst, und der Fehler summiert sich
nach unten. `hoehen_festschreiben()` gibt jeder Zeile eine.

## Der Typ kommt aus der Endung

Der Eimer `dokumente` lässt nur eine feste Liste zu. Der Browser schickt je
nach Gerät `application/octet-stream`; die Ablage antwortete dann mit 415, und
der Aufrufer sah ein 502 „Ablegen fehlgeschlagen" — ein Fehler über die Datei,
der wie ein Serverproblem aussah. `mime_aus()` leitet den Typ aus der Endung
ab und lehnt Unerwünschtes selbst ab, mit einem Satz, der die Ursache nennt.

## Fallen

- **Die Feldliste hängt am Blatt, nicht am Katalog.** Wird ein Blatt neu
  erzeugt, entsteht ein neuer Vorgang mit neuer Kennung. Ein alter Scan gehört
  weiter zum alten Vorgang; die Route lehnt ihn ab, wenn die Kennung im QR
  nicht passt, und nennt die gefundene.
- **`libzbar0` muss im Abbild sein.** `pyzbar` ist nur die Bindung; ohne die
  Bibliothek wirft der Import, und zwar erst beim ersten Scan.
- **Ein Vorgang aus einer älteren Fassung hat kein `feld_layout`.** Die
  Scan-Route sagt das, statt stillschweigend nichts zu prüfen.
