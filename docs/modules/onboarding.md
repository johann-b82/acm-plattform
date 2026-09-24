# Onboarding — Eintritte und ihr Schulungsplan

Wer neu ist, und welche Schulungen die Anforderungsmatrix für ihn verlangt.
Unter `/hr/onboarding`, mit dem Recht `hr`.

## Die Ableitung steht in der Datenbank

Im Altprojekt rechnet ein Python-Service Anforderungsmatrix und Bestand
zusammen. Beide sind Tabellen — das ist ein Verbund, kein Programm. Hier ist es
die Funktion `public.schulungsplan(employee_id)`.

Das hat zwei praktische Folgen: die Oberfläche kommt ohne eigene Route daran
(PostgREST ruft die Funktion), und der Plan ist immer aktuell. Er wird nicht
gespeichert — ändert sich die Matrix, ändert sich der Plan.

## Vier Geltungen, ein Weg hinein

Die Funktion rechnet die vier Geltungen der Anforderungsmatrix gegen Abteilung
und Position der Person:

| Geltung | greift, wenn |
|---|---|
| `alle` | immer |
| `abteilung` | die Abteilung der Person passt |
| `position` | die Position der Person passt |
| `abteilung_position` | beide passen |

`quelle` in der Rückgabe nennt die Geltung, über die eine Schulung Pflicht
wurde. Die Position schreibt Personio uneinheitlich („CNC-Fräser",
„CNC Fräser  "); verglichen wird deshalb über `public.position_norm()` —
kleingeschrieben, Mehrfachleerzeichen zusammengefasst. Das frühere Kürzel-System
und der „kuerzel_fehlt"-Hinweis sind mit der Umstellung auf Positionen entfallen.

## Die Abteilung lässt sich übersteuern

Personio ist lesend angebunden, und nicht jede Person hat dort eine Abteilung.
`onboarding_abteilung` hält einen hier gesetzten Wert, der den Personio-Wert für
diese Anwendung ersetzt. In Personio ändert sich dadurch nichts.

## Anlegen heißt: offene Zeilen

`schulungsplan_anlegen()` schreibt die fehlenden Pflichtschulungen als
Teilnahmen **ohne Datum**. Damit taucht die Person in der Schulungsübersicht
auf, ohne eine Fälligkeit vorzutäuschen. Ein zweiter Lauf legt nichts doppelt
an (`on conflict do nothing`), und ohne `hr: editor` bricht die Funktion mit
`42501` ab — sie prüft das Recht selbst, weil eine Funktion die RLS ihrer
Aufrufer nicht erbt.

### Eine Falle beim Bauen

`declare name text` in einer plpgsql-Funktion, deren Abfrage eine Spalte `name`
verbindet, ergibt „column reference is ambiguous". Die Variable heißt jetzt
`person_name`, und die Abfrage qualifiziert ihre Spalten.

## Die Papiere: ein Dokument, nicht zwei

    GET /api/onboarding/uebersicht.pdf   Formblatt 71 allein
    GET /api/onboarding/paket.pdf        Einarbeitungsplan + Schulungsübersicht

Das Paket ist kein zusammengefügtes PDF, sondern **eine Arbeitsmappe mit zwei
Blättern**; LibreOffice wandelt sie in einem Zug. Das spart eine
PDF-Zusammenführung als Abhängigkeit — und jedes Blatt behält seine eigene
Seiteneinrichtung, was ein Zusammenfügen nicht garantieren würde.

Reihenfolge: erst der Einarbeitungsplan (die ersten vier Wochen), dann die
Schulungsübersicht (was darüber hinaus ansteht).

**Zeitraum und Kreuze bleiben leer.** Für einen Neueintritt ist das Blatt der
Plan, den er abarbeitet. Ein Datum vorzugeben, das noch niemand terminiert hat,
wäre erfunden — und stünde hinterher gedruckt im Ordner.

Für extern gepflegte Personen gibt es keine Personio-Kennung und damit keinen
Plan aus `schulungsplan()`. Dann kommt das Blatt leer, aber mit Tabellenkopf.
Ein leeres Formular ist brauchbar, ein erfundenes nicht.

## Das Paket zu erzeugen *ist* die Übergabe

`paket.pdf` vermerkt beim ersten Abruf, dass sie stattgefunden hat — damit
verschwindet die „neu"-Markierung aus der Eintrittsliste. Beim zweiten Abruf
passiert nichts mehr: der Vermerk sagt „ist übergeben worden", nicht „ist
zuletzt gedruckt worden".

Geschrieben wird mit `on conflict do nothing` statt erst lesen, dann schreiben:
zwei gleichzeitige Abrufe liefen sonst in den eindeutigen Index, und der zweite
bekäme einen Fehler — für eine Nebensache, die niemanden interessiert.

Der Knopf „Vermerken" bleibt daneben stehen, für den Fall, dass die Übergabe
außerhalb der Anwendung passiert ist.

## Was noch fehlt

Nichts mehr aus dem Altprojekt. Offene Punkte stehen in `docs/backlog.md`.
