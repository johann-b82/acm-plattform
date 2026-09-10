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
Wartungsnachweis. **Ohne Druckskalierung**: mit ihr verschieben sich die
Zeilenhöhen, und die Freigabezeile sitzt nicht mehr am Blattfuß.

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

## Was noch fehlt

Der Vorgang um den Bogen herum: QR-Code zur Zuordnung, Laufweg (erstellt →
übergeben → zurück → geprüft), Scan-Upload und die halbautomatische
Vollständigkeitsprüfung. Dieselbe Mechanik gibt es im Altprojekt auch für den
Schulungsnachweis; sie gehört einmal gebaut und zweimal benutzt. Steht als ein
Punkt in `docs/backlog.md`.
