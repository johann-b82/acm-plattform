# Audit — Planung, Phasen und ein Verlauf, der hält

Ein Audit wird geplant, läuft seine Phasen-Checkliste durch und wird formal
abgeschlossen. Unter `/qualitaet`, mit dem Recht `quality`; die Stammdaten
(Normmatrix, Phasenvorlagen) unter `/einstellungen#qualitaet`.

Das Modul ist eine ziemlich genaue Übernahme — mit drei Unterschieden. Alle
drei stehen im Altprojekt als offener Punkt in der eigenen Doku.

## 1. Der Verlauf ist wirklich unveränderlich

Im Altprojekt schreibt ausschließlich ein Service in die Tabelle, und der
Router bietet kein `UPDATE` an. Die eigene Doku sagt dazu, dass das
Unveränderlichkeit **auf Anwendungsebene** ist: wer Tabellenrechte hat, kann
trotzdem ändern.

Hier liegt der Riegel doppelt:

* `authenticated` hat auf `audit_verlauf` nur `select` und `insert`. Kein
  `update`, kein `delete` — auch nicht für die Plattform-Verwaltung.
* Ein Trigger weist beides zusätzlich ab, unabhängig von der Rolle. Selbst
  `postgres` kommt nicht durch (nachgemessen).

Der Preis: das Aufräumen im Test muss den Trigger kurz abschalten. Das ist der
richtige Preis.

## 2. Der Verlauf weiß, wer gehandelt hat

Im Altprojekt trägt das Token nur eine UUID; `CurrentUser.email` ist dort ein
Platzhalter, und den in ein revisionssicheres Protokoll zu schreiben hätte eine
Identität erfunden. Deshalb steht dort **nur** die UUID.

Hier kommen `auth.uid()` und die echte Adresse aus dem Token — gesetzt vom
Trigger, nicht vom Aufrufer, also auch nicht fälschbar durch die Maske.

## 3. Der Verlauf schreibt sich selbst

Im Altprojekt ruft jeder Router-Handler den Trail-Service auf. Vergisst einer
das, fehlt der Eintrag — und im neuen Stack gäbe es zusätzlich den Weg über
PostgREST, der an jedem Handler vorbeiführt.

Hier hängt ein Trigger an `audits` und `audit_phasen`. Was in der Datenbank
passiert, steht im Verlauf, egal wer es ausgelöst hat.

Festgehalten wird bewusst grob: jede **Status**änderung Feld für Feld, alles
andere als „geändert". Ein Verlauf, der jede Tippkorrektur aufzählt, wird nicht
gelesen.

### Zwei Fallen dabei

Beide sind dieselbe: **plpgsql löst die Feldverweise eines Ausdrucks vorab
auf**, auch die im nicht genommenen Zweig. Ein `case tg_table_name when
'audits' then new.id else new.audit_id end` scheitert deshalb an `audits` mit
„record new has no field audit_id" — obwohl der Zweig nie läuft. Auflösung: ein
`if` je Tabelle, und den Grund vorher in eine Variable. (Dieselbe Falle stand
schon in `docs/modules/atr.md`.)

## Was übernommen wurde, weil es richtig war

**„Überfällig" ist kein gespeicherter Status.** Es ist eine Funktion des Datums
und würde in dem Moment schal, in dem ein Tag ohne Schreibvorgang vergeht. Die
Sicht `audit_stand` rechnet es beim Lesen aus — samt Fortschritt und nächstem
Termin, in einer Abfrage für alle Audits.

**Die Phasen werden kopiert, nicht verknüpft.** Eine später geänderte Vorlage
schreibt keine Historie um. Hier passiert das Kopieren in einem Trigger, damit
auch ein Anlegen über PostgREST seine Checkliste bekommt.

**Kein Löschen.** Ein Audit, das es nicht hätte geben sollen, wird abgesagt,
nicht gelöscht — sonst nähme es seinem Verlauf den Gegenstand weg. Normen
werden stillgelegt; der Fremdschlüssel steht auf `restrict`.

**Zwei Bedingungen an den Phasen.** Eine Pflichtphase entfällt nicht ohne
Begründung, und „erledigt" braucht ein Datum. Die Maske fragt vorher — die
Datenbank hält es trotzdem.

## Gleichzeitig arbeiten

Audits und Phasen gehören zur Phase 1 von ADR-0006: Status, Stammdaten und
jede Phase speichern nur mit der geladenen `version`. Hat jemand anders das
Audit oder die Phase inzwischen geändert, sagt die Maske es und lädt den
aktuellen Stand, statt still zu überschreiben. Die Prüfungen der Phasen
(Begründung, Datum) melden sich weiter mit ihrem eigenen Text.

Der Stammdaten-Entwurf und die Phasenmaske speichern mit der Version, mit der
sie geöffnet wurden — nicht mit dem Stand, den die Seite inzwischen live
nachgeladen hat. Sonst überschriebe ein offener Entwurf still, was ein
anderer gerade gespeichert hat.

Übersicht und Audit bleiben live (`tabelle:audits`, `tabelle:audit_phasen`);
im Audit steht, wer es gerade noch offen hat. Kategorien und Normbezüge sind
Zuordnungen ohne eigene Version — dort gilt weiter: wer zuletzt setzt, gilt.

## Was noch fehlt

Findings und Maßnahmen (CAPA), das Auditprogramm als Jahresplan und der
PDF-Export sind auch im Altprojekt nicht umgesetzt („deliberately out of scope",
v1.84). Die Rollentrennung Auditor / Lead-Auditor / Auditierter fehlt dort
ebenfalls; hier wäre sie mit dem App-Rechtemodell machbar, ist aber ohne
fachliche Vorgabe nicht zu raten. Steht in `docs/backlog.md`.
