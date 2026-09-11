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

Ein Test hält das fest: er baut ein Zeugnis-DOCX und lässt LibreOffice ein PDF
daraus machen. Fehlt Writer im Abbild, schlägt er fehl — genau an der Stelle,
an der der Fehler sonst erst vor Ort aufgefallen wäre.

## Zwei Unterschriften, zwei Herkünfte

Unter dem Zeugnis stehen zwei Namen, und nur einer davon ist für alle gleich.

| | wer | woher |
|---|---|---|
| links | die **fachliche** — der oder die Vorgesetzte der Person | Personios Organisationsstruktur |
| rechts | die **personalseitige** | Ausstellerprofil (`/einstellungen#zeugnisse`) |

Die linke hängt an der Person, nicht am Haus: wer in der Näherei arbeitet,
bekommt die Unterschrift der Näherei. Sie wird deshalb beim Setzen aufgelöst,
aus `raw_json.attributes.supervisor` — ein Feld, das der Abgleich ohnehin
mitbringt. Die Position darunter kommt aus dem vollen Datensatz der
vorgesetzten Person; am eingebetteten Knoten steht sie oft nicht.

Personio führt neben Vor- und Nachname einen `preferred_name`. Der geht vor:
er ist das, was im Haus auf dem Türschild steht.

**Beide fallen auf Freitext zurück.** Es gibt genug Fälle, in denen Personio
nichts hergibt — extern gepflegte Personen, ein nicht gepflegter Vorgesetzter,
ein Abgleich, der gerade nicht gelaufen ist. Ein Zeugnis ohne Unterschrift wäre
wertlos. Umgekehrt wird nichts erfunden: ist auch der Freitext leer, bleibt die
Unterschrift leer und die Maske sagt es.

`GET /api/zeugnisse/{id}/unterschriften` zeigt beide **vor** dem Erzeugen,
samt Herkunft. Ohne das fiele ein fehlender Vorgesetzter erst im fertigen PDF
auf — und dann ist das Zeugnis schon gedruckt.

## Was noch fehlt

Nichts mehr aus dem Altprojekt. Offene Punkte stehen in `docs/backlog.md`.
