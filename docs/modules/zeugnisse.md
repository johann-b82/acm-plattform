# Zeugnisse — aus Noten wird Zeugnissprache

Ein Arbeitszeugnis aus Schulnoten und Stichpunkten, gesetzt auf der echten
ACM-Briefvorlage. Unter `/hr/zeugnisse`.

**Kein Lesen ohne Bearbeiten.** Anders als in den übrigen HR-Modulen gibt es
hier keine reine Lesestufe: ein Zeugnisentwurf ist eine Leistungsbewertung mit
Namen daran. Die Policies verlangen durchweg `hr: editor`.

## Die Stammdaten werden abgeschrieben, nicht verknüpft

Ein im Mai ausgestelltes Zeugnis darf im September nicht anders aussehen, weil
sich in Personio eine Abteilung geändert hat. Name, Tätigkeit, Abteilung und
Zeiten stehen deshalb als Abschrift in der Zeugniszeile — danach von Hand
änderbar, aber nie automatisch.

## Die Note ist eine Schulnote

1 bis 4 je Dimension, daraus der Durchschnitt (kaufmännisch gerundet), daraus
die verkehrsübliche Zufriedenheitsformel:

| Durchschnitt | Formel |
|---|---|
| 1 | stets zu unserer vollsten Zufriedenheit |
| 2 | stets zu unserer vollen Zufriedenheit |
| 3 | zu unserer vollen Zufriedenheit |
| 4 | zu unserer Zufriedenheit |

Die Skala steht im Baukasten, nicht in der Datenbank: sie ist Sprache, keine
Konfiguration. Die **Formulierungen** dagegen stehen in `zeugnis_bausteine` und
lassen sich pflegen; ohne Eintrag greifen die Vorgaben aus dem Baukasten.

## Zwei Wege zum Text

**Der Baukasten** setzt die fünf Abschnitte aus festen Formulierungen zusammen
— ohne Netz, ohne Schlüssel, jederzeit. Er ist der Normalfall.

**Die KI** formuliert freier. Was an sie geht, ist bewusst wenig: Anrede,
Rolle, Abteilung, Beschäftigungsdauer, Noten und die HR-Freitexte. **Name,
Geburtsdatum und Personalnummer verlassen den Server nicht** — die KI setzt den
Platzhalter `[NAME]`, der erst hier durch „Herr/Frau Nachname" ersetzt wird.
Ohne `ANTHROPIC_API_KEY` bleibt sie inaktiv und meldet das; der Baukasten
schreibt dann.

## Nie misgendern

Die Bausteine tragen Pronomen-Platzhalter (`[ER_SIE]`, `[SEINE_IHRE]`, …). Ohne
Angabe zum Geschlecht wird **nicht geraten**, sondern geschlechtsneutral
formuliert („die Person", „der Person"). Am Satzanfang wird großgeschrieben.

## Das Dokument

DOCX auf der echten ACM-Briefvorlage: Kopf- und Fußzeile (Logo,
Zertifizierungen, Anschrift), Times New Roman und die Ränder bleiben, der
Textkörper wird geleert und neu gefüllt. Ein anderer Aussteller bekommt einen
schlichten selbst gebauten Kopf — die Firmenbeschreibung gehört der ACM.

Das PDF entsteht über LibreOffice. **Dafür musste Writer ins Abbild**: bis
dahin war nur Calc installiert (für die Excel-Formblätter), und Calc kann eine
`.docx` nicht öffnen — LibreOffice meldet dann `source file could not be
loaded`, was nach einer kaputten Datei klingt und keine ist.

> **Ungeprüft.** Das DOCX ist lokal entstanden und nachgesehen (147 KB, 18
> Absätze, Titel „Endzeugnis"). Die Umwandlung nach PDF **mit** Writer ist es
> nicht: der Neubau des Abbilds lief in eine Speichergrenze der
> Entwicklungsmaschine. Der erste Lauf vor Ort ist damit zugleich die Probe.
> Steht in `docs/backlog.md`.

## Was noch fehlt

Die Vorschlagsliste für Vorgesetzte aus Personio (zweite Unterschrift) ist
angelegt, aber noch nicht befüllt: das Feld `hr_employee_id` am Aussteller wird
aufgelöst, ein abteilungsabhängiger Vorgesetzter noch nicht. Steht in
`docs/backlog.md`.
