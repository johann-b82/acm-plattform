# Einarbeitung — Inhalte, Matrix und der persönliche Bogen

Was eine neue Person lernen muss, wer es ihr zeigt, und das Formblatt dazu.
Unter `/hr/einarbeitung`, mit dem Recht `hr`.

## Ein Inhalt gehört einem Ansprechpartner, nicht einer Abteilung

Dieselbe Trennung wie bei den Schulungen, und aus demselben Grund: sonst stünde
„Sicherheitsunterweisung an der Fräse" für jede Abteilung noch einmal in der
Liste, mit demselben Ansprechpartner und derselben Beschreibung. Der Katalog
hält den Inhalt, die Matrix sagt, welche Abteilung ihn braucht.

Das Feld `bereich` am Inhalt übersteuert die Abteilung auf dem Bogen. Ist es
leer, steht dort die Abteilung aus der Matrix — so gibt derselbe Inhalt für
zwei Abteilungen zwei verschiedene Zeilen, ohne doppelt gepflegt zu werden.

## Der Bogen

Kopfzeilentabelle nach ACM-Standard (Formblattnummer, Titel, Revision, Logo),
Kopf mit Name, Stelle, Beginn und dem gerechneten Ende (vier Wochen), die
Regeln und das Ziel, die Inhaltstabelle mit den Spalten „Wann?" und
„Erledigt / Unterschrift" zum Ausfüllen, zuletzt die Freigabezeile.

Gebaut mit openpyxl, gewandelt von LibreOffice — dieselbe Kette wie beim
Wartungsnachweis.

**A4, und eine Seite breit.** Beides musste nachgezogen werden, und beides
fällt sonst erst am Drucker auf:

* Ohne gesetzte Papiergröße druckt LibreOffice **Letter** — 216 × 279 mm statt
  210 × 297. `pdfinfo` meldete das für jedes erzeugte Formblatt. Dafür gibt es
  jetzt `app/dokumente/blatt.py`, damit man es nicht an vier Stellen vergessen
  kann.
* Der Bogen lief seitlich über. Die zweite Seite trug nur die abgeschnittenen
  rechten Spalten — „Wann?" und „Erledigt / Unterschrift", also genau die
  Felder, die von Hand ausgefüllt werden.

Hier stand vorher feste Skalierung ohne Anpassung, weil eine Skalierung die
Zeilenhöhen verschiebt. Das Ergebnis war schlimmer als das Problem. Jetzt
`fitToWidth = 1` und `fitToHeight = 0`: eine Seite breit, so viele Seiten hoch
wie nötig.

Spaltenbreiten in „Zeichen" auszurechnen hilft nicht: LibreOffice hat im Abbild
kein Calibri und ersetzt es durch eine breitere Schrift. Ich habe es mit
schmaleren Spalten versucht und gemessen — es reichte nicht. Die Anpassung ist
deshalb nicht Bequemlichkeit, sondern das einzig Verlässliche.

Die Zeilenhöhe wird aus der Textlänge gerechnet, weil ein langer Inhalt sonst
abgeschnitten wird. Ein Test hält fest, dass eine lange Zeile höher ausfällt
als eine kurze.

## Das Logo

Eine Zeile in `plattform_logo`, das Bild im Eimer `plattform`, gepflegt unter
`/einstellungen#erscheinung`. Es steht auf jedem erzeugten Formblatt.

**Nur PNG oder JPEG.** Das Altprojekt lässt zusätzlich SVG zu und muss es dafür
mit `nh3` reinigen, weil eine SVG-Datei Skripte tragen kann. Gebraucht wird das
Logo aber in den Formblättern, und dort kann openpyxl ohnehin kein SVG
einbetten — die dortige Doku sagt selbst „für die Dokumente ein PNG
hochladen". Der Fall entfällt damit, statt behandelt zu werden; eine Bedingung
an der Spalte hält es fest.

Fehlt das Logo, entsteht das Blatt trotzdem — ohne Bild, aber vollständig.

## Der Vorgang um den Bogen herum

QR-Code zur Zuordnung, Laufweg, Scan-Upload und die halbautomatische
Vollständigkeitsprüfung stehen — einmal gebaut, für beide Formblätter benutzt.
Siehe `docs/modules/dokumentenlauf.md`. Der gewöhnliche Ausdruck über
`/api/einarbeitung/bogen.pdf` bleibt daneben: nicht jeder Bogen braucht einen
Vorgang.
