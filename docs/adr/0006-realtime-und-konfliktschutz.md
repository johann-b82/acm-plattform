# ADR-0006: Realtime und Konfliktschutz

Status: angenommen (September 2026)

## Kontext

Mehrere Personen arbeiten gleichzeitig in denselben Modulen — an einer
ATR-Lieferung, an einem Audit, an der Wartung. Bisher gilt: wer zuletzt
speichert, gewinnt, still. Wer eine Seite offen hat, sieht Änderungen anderer
erst nach dem nächsten Laden. Beides kann zu Dateninkonsistenzen führen:
eine Änderung geht verloren, oder jemand arbeitet auf einem Stand weiter, der
längst nicht mehr gilt.

Der Plan sah Supabase Realtime „nur wo nötig“ vor (Entscheidung A, Tabelle
der Ablösungen). Der Realtime-Dienst läuft im Stack, wurde aber nicht genutzt.

## Entscheidung

**1. Optimistische Sperre über eine Version je Zeile.** Jede freigegebene
Tabelle bekommt `version integer not null default 1`. Ein Trigger
(`zeile_versionieren`) setzt sie bei jeder Änderung auf die alte Version + 1 —
auch wenn `compute` oder ein Import schreibt, und auch wenn jemand die Version
selbst mitschickt. Die Oberfläche speichert und löscht nur mit der Bedingung
`version = <geladene Version>`. Trifft das keine Zeile, war jemand anders
schneller: die Oberfläche sagt es und lädt den aktuellen Stand. Nichts wird
still überschrieben.

Keine Bearbeitungssperren: sie müssten ablaufen (Tab offen gelassen) und
blockieren auch dann, wenn niemand wirklich gleichzeitig schreibt.

**Entwürfe und Felder merken sich ihre Version.** Weil offene Seiten live
nachladen, wäre die gerade angezeigte Version beim Speichern oft schon die
eines anderen — der Konfliktschutz griffe nie, und ein offener Entwurf
überschriebe still, was inzwischen gespeichert wurde. Eine Maske mit
„Speichern“ nutzt deshalb die Version, mit der sie geöffnet wurde; ein Feld,
das beim Verlassen speichert, die Version beim Betreten. Eigene Speicherungen
in schneller Folge setzen diese Version fort, statt als Konflikt mit sich
selbst zu enden. Ändert ein anderer einen Wert, erscheint er im Feld, das
gerade niemand bearbeitet.

**Nicht jede Spalte ist Inhalt.** Der Versionstrigger nimmt Spalten entgegen,
deren Änderung allein nicht zählt — bei App Feedback `gesehen_am`. Die
Version bleibt dann stehen; gemeldet wird die Änderung trotzdem.

**2. Änderungen melden über private Realtime-Kanäle, ohne Inhalt.** Ein
Trigger (`aenderung_melden`) ruft nach jedem Insert, Update und Delete
`realtime.send` auf dem Kanal `tabelle:<name>`. Die Meldung trägt nur Tabelle,
Vorgang und Kennung. Offene Seiten laden daraufhin die betroffenen Abfragen
über PostgREST neu — die Leseregeln (RLS) gelten also unverändert. Stünde der
Inhalt in der Meldung, sähe ihn jeder, der den Kanal empfangen darf, auch
wenn die Zeilenregel ihm diese Zeile verweigert.

`compute` bleibt zustandslos: kein SSE, kein eigener Fanout. Die Datenbank
meldet, der Realtime-Dienst verteilt.

**3. Kanalrechte aus demselben Claim.** Welche Tabelle freigegeben ist und
welches Recht ihr Kanal verlangt, steht in `public.realtime_tabellen`
(Tabelle, App, Mindeststufe). Die Regeln auf `realtime.messages` prüfen:
empfangen (`select`) darf, wer die App mindestens in dieser Stufe hat; bei
Presence zusätzlich eintragen (`insert`). Eine Änderungsmeldung
(`extension = 'broadcast'`) darf niemand selbst schreiben — sonst ließe sich
allen offenen Seiten ein Neuladen aufzwingen. Die Rechte kommen weiter nur aus
dem JWT-Claim `apps`.

**4. Anwesenheit über Presence.** Detailseiten treten dem Kanal
`datensatz:<tabelle>:<kennung>` bei und zeigen „Auch geöffnet von …“. Presence
hält keinen Zustand in der Datenbank; wer die Seite schließt, verschwindet.

**5. In Phasen.** Phase 1: ATR-Lieferungen und -Positionen, Audits und
Audit-Phasen, Maschinen und Wartungsaufgaben, App Feedback. Weitere Module
folgen je eigener Migration: Zeile in `realtime_tabellen`, Spalte `version`,
die beiden Trigger, Schreibwege mit Versionsbedingung.

## Ausnahme von der DDL-Invariante

Alembic ist alleiniger DDL-Eigentümer von `public.*`; `realtime` gehört
Supabase. Die Regeln auf `realtime.messages` lassen sich aber nur dort
anlegen — so sieht es Supabase für private Kanäle vor. Migration
`0057_realtime_konfliktschutz` legt deshalb **ausschließlich Policies** auf
`realtime.messages` an, keine Tabellen, Spalten oder Funktionen im Schema
`realtime`. Der Downgrade entfernt sie wieder.

## Konsequenzen

- Jeder Schreibweg einer freigegebenen Tabelle in der Oberfläche prüft die
  Version. `compute` schreibt ohne Prüfung (Importe, Erzeugung), erhöht die
  Version aber über den Trigger — eine offene Seite erkennt den Konflikt beim
  nächsten Speichern.
- Fällt der Realtime-Dienst aus, bleibt die Plattform bedienbar: Seiten laden
  wie bisher beim Zurückkehren ins Fenster neu, der Konfliktschutz hängt nicht
  am Kanal.
- Der Plattform-Caddy reicht `/supabase/realtime/*` ohne Cookies an Kong
  weiter. Der Browser schickt beim WebSocket-Aufbau alle Cookies mit; das
  Sitzungs-Cookie mit dem `apps`-Claim sprengt die Kopfzeilengrenze des
  Realtime-Dienstes (HTTP 431, gefunden beim Test im Browser). Realtime braucht
  keine Cookies — der Schlüssel steht in der Adresse, das Token kommt beim
  Beitritt zum Kanal.
- `realtime.messages` ist nach Tagen partitioniert; der Dienst räumt alte
  Partitionen selbst ab (`RUN_JANITOR`). Die Meldungen sind klein, weil sie
  keinen Inhalt tragen.
- Der Test-Stub bildet `realtime.messages`, `realtime.topic()` und
  `realtime.send()` der gepinnten Version nach. Ein Update des Realtime-Images
  muss gegen den Stub geprüft werden.
