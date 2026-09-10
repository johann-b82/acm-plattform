# Onboarding — Eintritte und ihr Schulungsplan

Wer neu ist, und welche Schulungen die Anforderungsmatrix für ihn verlangt.
Unter `/hr/onboarding`, mit dem Recht `hr`.

## Die Ableitung steht in der Datenbank

Im Altprojekt rechnet ein Python-Service Anforderungsmatrix, Rollenzuordnung
und Bestand zusammen. Alle drei sind Tabellen — das ist ein Verbund, kein
Programm. Hier ist es die Funktion `public.schulungsplan(employee_id)`.

Das hat zwei praktische Folgen: die Oberfläche kommt ohne eigene Route daran
(PostgREST ruft die Funktion), und der Plan ist immer aktuell. Er wird nicht
gespeichert — ändert sich die Matrix, ändert sich der Plan.

## Zwei Ebenen, zwei Wege hinein

| Ebene | Weg |
|---|---|
| `personio` | über die Abteilung der Person |
| `kuerzel` | über die Zuordnung Position → Abteilungskürzel |

Die zweite ist die unzuverlässigere: Personio schreibt Positionen uneinheitlich
(„CNC-Fräser", „CNC Fräser  "). Verglichen wird deshalb über
`public.position_norm()` — kleingeschrieben, Mehrfachleerzeichen zusammengefasst.

## Der Hinweis, wenn die feine Ebene nicht greift

Fehlt für eine Position die Zuordnung, entstünden **zu wenige**
Pflichtschulungen — und niemand würde es merken. Die Funktion gibt deshalb eine
eigene Zeile mit `quelle = 'kuerzel_fehlt'` zurück, und die Oberfläche macht
daraus einen Kasten in Warnfarbe.

Das ist aus dem Altprojekt übernommen; dort steht dieselbe Überlegung im
Docstring des Services.

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

## Was noch fehlt

Das Onboarding-Paket als PDF (Formblatt 71 und die Dokumentmappe) ist im
Altprojekt vorhanden und hier noch nicht portiert; die Übergabe lässt sich
bereits vermerken. Steht in `docs/backlog.md`.
