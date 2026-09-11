import type { Gruppe } from "./registry";

export const KENNZAHLEN: Gruppe = {
  id: "kennzahlen",
  titel: "Kennzahlen",
  beschreibung: "Was die Dashboards zeigen und wie die Zahlen zustande kommen.",
  seiten: [
    {
      slug: "so-lesen-sich-kennzahlen",
      titel: "So lesen sich die Kennzahlen",
      kurz: "Zeitraum, Vergleichswerte, Zielwerte und Verläufe — einmal für alle Seiten.",
      text: `
# So lesen sich die Kennzahlen

Diese Regeln gelten auf jeder Kennzahlenseite. Steht auf einer Seite etwas
anderes, gilt das dort Genannte.

## Der Zeitraum

Oben steht der Zeitraum. Er gilt für alles darunter. Vorgewählt ist **dieses
Jahr** — vom 1. Januar bis heute.

Alle Datumsvergleiche schließen die Ränder ein: „1.3. bis 31.3." enthält beide
Tage.

## Vergleichswerte

Neben einer Kachel steht oft ein kleines Abzeichen mit einer Veränderung.
Verglichen wird mit einem gleich langen Fenster, das am Tag vor dem gewählten
Zeitraum endet — und beim Vorjahr mit demselben Fenster 365 Tage früher.

**365 Tage, nicht derselbe Kalendertag.** Über ein Schaltjahr verschiebt sich
das um einen Tag. Das ist bewusst so: ein Vergleich „gleich viele Tage" ist für
Mengen ehrlicher als einer, der mal 365 und mal 366 Tage umfasst.

Gibt es keinen Vergleichszeitraum oder war er null, steht dort ein Strich —
keine Zahl. Eine Steigerung von null auf irgendetwas ist keine Prozentangabe.

Die Farbe folgt der **Bedeutung**, nicht dem Vorzeichen. Bei Verzugsquote und
Reklamationsquote ist weniger besser; dort ist ein Rückgang grün.

## Zielwerte

Viele Kacheln zeigen eine Ziellinie oder färben sich, sobald ein Wert daneben
liegt. Die Zielwerte stehen unter **Einstellungen → Kennzahlen** und gelten für
alle. Ohne gesetzten Zielwert gibt es keine Linie und keine Warnfarbe — die
Kachel zeigt nur den Wert.

## Verläufe

Ein Verlaufsdiagramm fasst den Zeitraum automatisch zusammen:

| Zeitraum | Ein Punkt ist |
|---|---|
| bis 31 Tage | ein Tag |
| bis 91 Tage | eine Kalenderwoche |
| bis rund zwei Jahre | ein Monat |
| darüber | ein Quartal |

Je Punkt wird **dieselbe Formel** gerechnet wie für die Kachel — nicht ein
Mittelwert aus Mittelwerten.

## Warum Zahlen nicht gespeichert werden

Quoten und Fälligkeiten stehen nirgends als Spalte, sie werden beim Lesen
gerechnet. Das kostet etwas Rechenzeit und erspart eine ganze Klasse von
Fehlern: ändert jemand einen Turnus, eine Zuordnung oder einen Zielwert, stimmt
die Zahl sofort. Eine gespeicherte Zahl bliebe stehen und behauptete etwas
Falsches, bis jemand sie neu berechnet.
`.trim(),
    },
    {
      slug: "vertrieb",
      titel: "Vertrieb",
      kurz: "Auftragswert, Auftragsverlauf, Kundenanteil und die Aktivität je Erfasser.",
      text: `
# Vertrieb

Unter **Kennzahlen → Vertrieb**. Grundlage sind die ERP-Auszüge, die unter
*Uploads* eingelesen werden: Aufträge, Auftragspositionen, Angebote,
Interessenten, Umsatz.

## Die Kacheln

* **Auftragswert** — Summe der Auftragswerte im Zeitraum.
* **Durchschnittlicher Auftragswert** — Auftragswert geteilt durch die Anzahl
  der Aufträge.
* **Aufträge gesamt** — Anzahl der Aufträge im Zeitraum.

**Aufträge mit Wert 0 € zählen nicht mit.** Sie stehen im ERP für Gutschriften,
Storni und Platzhalter; in einer Umsatzkennzahl würden sie den Durchschnitt
verfälschen.

## Umsatzverlauf

Der Verlauf über den gewählten Zeitraum, zusammengefasst wie unter *So lesen
sich die Kennzahlen* beschrieben. Ist ein Zielwert hinterlegt, läuft er als
Linie mit.

## Kundenanteil

Eine Leiste zeigt, welchen Anteil die drei umsatzstärksten Kunden am
Auftragsvolumen haben — gegen den Rest. Daneben stehen sie namentlich mit ihrem
Anteil.

Die Kennzahl beantwortet eine Risikofrage, keine Umsatzfrage: **wie sehr hängt
das Haus an wenigen Kunden?**

## Vertriebsaktivität je Erfasser

Wie viele Aufträge je Erfasser und Kalenderwoche entstanden sind. Der Erfasser
kommt aus der Spalte *Benutzer* der Auftragsdatei — es ist also der, der den
Auftrag angelegt hat, nicht zwingend der, der ihn verkauft hat.

Fehlt die Spalte in einer älteren Datei, zählt diese Zeile nicht in den Nenner;
dann die Datei neu einlesen.
`.trim(),
    },
    {
      slug: "einkauf",
      titel: "Einkauf",
      kurz: "Liefertermintreue der Lieferanten und Ladenhüter im Lager.",
      text: `
# Einkauf

Unter **Kennzahlen → Einkauf**.

## Liefertermintreue

Der Anteil der Wareneingänge, die am zugesagten Termin oder früher kamen.
Grundlage ist die Liefertreue-Datei aus dem ERP.

Gerechnet wird auf **Positionsebene**, nicht je Lieferschein: eine Lieferung
mit fünf Positionen, von denen eine zu spät kam, ist zu vier Fünfteln pünktlich
und nicht vollständig unpünktlich.

## Ladenhüter

Bestände, die lange liegen. Die Liste zeigt Artikel mit Bestand, Wert und
Liegezeit — absteigend nach gebundenem Kapital, denn das ist die Frage, die
dahintersteht: **wo liegt Geld im Regal?**

Grundlage sind die Lagerbewegungen und die Lagerpreise. Ohne Preisdatei
erscheinen Mengen, aber keine Werte.
`.trim(),
    },
    {
      slug: "produktion",
      titel: "Produktion",
      kurz: "Aufträge in Verzug — und was „in Verzug“ hier heißt.",
      text: `
# Produktion

Unter **Produktion**. Dieselbe Seite trägt auch die Wartung; die steht unter
*Wartung und Maschinen*.

## Aufträge in Verzug

Ein Auftrag ist in Verzug, wenn sein bestätigter Liefertermin in der
Vergangenheit liegt und er nicht abgeschlossen ist.

Angezeigt werden:

* die **Verzugsquote** — Aufträge in Verzug geteilt durch offene Aufträge,
* die **Anzahl** und der **Wert** der verzögerten Aufträge,
* die **Liste** mit Kunde, Termin und Verzugstagen, nach Verzugstagen sortiert.

Weniger ist besser: ein Rückgang wird grün angezeigt.

## Grundlage

Zwei Dateien: die Auftragsköpfe und die Auftragspositionen. Beide werden unter
*Uploads* eingelesen. Der Verzug wird beim Lesen gerechnet — ein Auftrag, der
heute fällig wird, taucht morgen von selbst auf, ohne dass jemand etwas
anstößt.
`.trim(),
    },
    {
      slug: "qualitaet",
      titel: "Qualität",
      kurz: "Prüfmengen, Ausschussquote und Reklamationen.",
      text: `
# Qualität

Unter **Qualität**. Dieselbe Seite trägt auch die Audits; die stehen unter
*Audits*.

## Prüfmengen und Ausschuss

Aus der Prüfungsdatei: geprüfte Menge, davon in Ordnung, davon Ausschuss. Die
**Ausschussquote** ist Ausschuss geteilt durch geprüfte Menge.

Über den Filter **Fertig / Halbfertig / Alle** lässt sich die Artikelart
einschränken — Halbfertigware hat naturgemäß andere Quoten als Fertigware, und
ein gemeinsamer Wert verdeckt beides.

Der Tooltip an einer Prüfung nennt die Prüfer und ihre Anzahl. Das ist kein
Ranking, sondern eine Einordnung: eine Quote aus einer Prüfung eines einzelnen
Prüfers wiegt anders als eine aus fünfzig Prüfungen von vier Prüfern.

## Reklamationsquote

Der Anteil reklamierter Lieferungen. Weniger ist besser; ein Rückgang wird grün
angezeigt.

## Audits

Die Auditplanung liegt auf derselben Seite, ist aber etwas anderes als die
Kennzahlen — siehe *Audits*.
`.trim(),
    },
    {
      slug: "finanzen",
      titel: "Finanzen",
      kurz: "Materialkostenquote und Personalkostenquote.",
      text: `
# Finanzen

Unter **Kennzahlen → Finanzen**.

## Materialkostenquote

Materialkosten geteilt durch Umsatz. Die Materialkosten kommen aus den
Wareneingängen, bewertet mit der Preisliste.

Die Preisliste ist dabei keine eigene Tabelle, die gepflegt werden müsste,
sondern eine Sicht auf die eingelesenen Preise. Wird eine neue Preisdatei
eingelesen, stimmt die Quote sofort.

## Personalkostenquote

Personalkosten geteilt durch Umsatz, dazu die Aufteilung nach Abteilung.

Die Personalkosten kommen aus dem Personio-Abgleich. Welche Abteilungen zur
Produktion zählen, steht unter **Einstellungen → Personal** — die Angabe
entscheidet über die Kennzahl *Umsatz je Produktionskopf*.

## Wenn eine Quote leer bleibt

Der Nenner ist der Umsatz. Ist für den Zeitraum kein Umsatz eingelesen, gibt es
keine Quote — und die Kachel zeigt das, statt durch null zu teilen oder eine
Null zu behaupten.
`.trim(),
    },
    {
      slug: "personal",
      titel: "Personal",
      kurz: "Überstunden, Krankheit, Fluktuation, Belegschaft und der Wochenbericht.",
      text: `
# Personal

Unter **Personal**. Grundlage ist der nächtliche Abgleich mit Personio.

## Der Abgleichstand ganz oben

Die erste Zeile der Seite sagt, **wann der Abgleich zuletzt lief** und ob er
Fehler meldete. Das steht bewusst oben: eine Personalkennzahl ohne frischen
Abgleich ist eine Aussage über vorgestern.

Wer das Recht *Verwalten* auf Personal hat, kann den Abgleich von Hand
anstoßen. Je nach Fenster dauert er ein bis mehrere Minuten.

## Die Quoten

* **Überstundenquote** — Mehrarbeit gegen Sollarbeitszeit.
* **Krankheitsquote** — Fehltage wegen Krankheit gegen Sollarbeitstage.
  Welche Abwesenheitsarten als Krankheit zählen, steht unter **Einstellungen →
  Personal**. Ohne diese Angabe bleibt die Kachel sichtbar leer.
* **Fluktuationsquote** — Austritte gegen durchschnittliche Belegschaft.

## Belegschaft und Kompetenzentwicklung

Kopfzahl, Eintritte und Austritte im Zeitraum. Die Kompetenzentwicklung zeigt,
bei wie vielen aktiven Personen mindestens eines der dafür festgelegten
Personio-Felder gepflegt ist. Welche Felder das sind, steht ebenfalls in den
Einstellungen.

Diese Kennzahl ist ein **Stichtagswert**, kein Verlauf: sie rechnet auf den
heutigen Stammdaten. Einen ehrlichen Verlauf gäbe es nur mit historischen
Ständen, und die gibt es nicht — deshalb steht dort auch kein Diagramm.

## Mitarbeitertabelle und Wochenbericht

Die Tabelle zeigt je Person Ist-Stunden und Überstunden im Zeitraum. Der
Wochenbericht fasst Mehrarbeit und Krankheit je Kalenderwoche zusammen — das
Blatt, das in der Besprechung auf dem Tisch liegt.
`.trim(),
    },
  ],
};
