# Anzeigen — Geburtstage und Neuzugänge auf den Bildschirmen

Zwei Tafeln im Flur: wer diese Woche Geburtstag hat, und wer zuletzt
angefangen hat. Der Signage-Player holt sie als Playlist-Eintrag vom Typ
„Adresse" und zeigt sie als lebenden Rahmen.

| Teil | Ort |
|---|---|
| Die beiden Seiten | `/embed/geburtstage`, `/embed/neuzugaenge` (ohne Anmeldung) |
| Adressen erzeugen | `/einstellungen#anzeigen` (Plattform-Verwaltung) |
| Routen, Token, Bildweg | `compute`, `app/embed.py` und `app/routers/embed.py` |
| Einrahmen erlaubt | `infra/caddy/Caddyfile`, Kopfzeilenblock `header /embed/*` |

Keine Migration: die Anzeigen lesen nur `personio_employees`.

## Warum ein Token und nicht einfach eine offene Route

Im Altprojekt sind das offene Routen unter `/api/hr/embed/*`. Wer die Adresse
kannte, las die Namen der Belegschaft; über die laufende Nummer im Bildweg ließ
sich die Liste durchzählen. Das ist **Befund 4** der Sicherheitsanalyse — und
die Doku des Altprojekts nennt die Lösung selbst: ein signierter Token je
Playlist-Eintrag, „der in der neuen Plattform liegt".

Der Token ist kurz und trägt nur, was er sagen muss:

```
base64url({"art":"geburtstage","bis":1789…}) . HMAC-SHA256(rumpf, EMBED_SECRET)
```

Daraus folgt dreierlei, ohne dass irgendwo eine Zeile gespeichert wird:

- **Eine Tafel sieht eine Anzeige.** Ein Token für Geburtstage öffnet die
  Neuzugänge nicht.
- **Er läuft ab** (Vorgabe ein Jahr). Ein Playlist-Eintrag, den niemand mehr
  pflegt, hört von selbst auf zu zeigen, statt jahrelang weiterzulaufen.
- **Alle auf einmal sperrt, wer `EMBED_SECRET` wechselt.** Es gibt keine Liste
  zu pflegen — und keine, die man vergessen kann.

Der Preis: ein erzeugter Token lässt sich nicht nachträglich anzeigen. Die
Einstellungsseite zeigt die fertige Adresse einmal zum Kopieren. Verloren heißt
neu erzeugen; das ist ein Klick.

Verglichen wird mit `hmac.compare_digest`, nicht mit `==`: der Vergleich soll
nicht verraten, wie weit ein Versuch gekommen ist.

## Was hinausgeht — und was nicht

| Feld | Geburtstage | Neuzugänge |
|---|---|---|
| Name, Abteilung | ja | ja |
| Wochentag (0 = Montag) | ja | — |
| Eintrittsdatum, Tage dabei | — | ja |
| **Geburtsdatum, Alter** | **nein** | **nein** |

Das Altprojekt liefert `occurs_on`, also das Datum. Eine Tafel hängt im Flur
und wird von jedem gesehen, der vorbeigeht; der Wochentag reicht für „heute hat
jemand Geburtstag", das Datum tut nichts dazu. Das Geburtsdatum verlässt den
Server gar nicht — es wird nur gelesen, um den Jahrestag in die laufende Woche
zu legen.

Der 29. Februar wird dabei zum 28., sonst fiele der Geburtstag in drei von vier
Jahren aus der Anzeige.

Das Geburtsdatum steht in den Personio-Rohdaten nicht an fester Stelle.
`geburtsdatum_aus()` sucht rekursiv nach einem Knoten mit
`label == "Geburtsdatum"` — ein fester Pfad bräche beim nächsten Umbau der
Schnittstelle still, und stille Brüche sind hier besonders teuer: die Tafel
zeigte einfach nichts mehr, und niemand meldet einen leeren Flurbildschirm.

## Der Bildweg

`GET /api/anzeige/foto/{id}` antwortet **nur für Personen, die gerade auf einer
Tafel stehen**. Das ist der Riegel gegen das Durchzählen: die Route schlägt vor
jeder Antwort dieselbe Liste nach, die die Tafel selbst bekommt.

Alle Absagen sind dasselbe 404 — nicht gezeigt, kein Bild hinterlegt, Personio
nicht eingerichtet. Eine unterscheidbare Antwort machte die Route wieder zum
Belegschaftsverzeichnis. Nur ein echter Fehler von Personio wird zu 502.

Zwei Bremsen davor:

- **Zwischenspeicher**, eine Stunde je Person, höchstens 200 Bilder. Ohne ihn
  fragte jede Tafel im Haus im Minutentakt bei Personio nach und liefe in
  dessen Drosselung.
- **Ratsperre** je Adresse (`app/ratsperre.py`), 60 Listen- und 120
  Bildabrufe je Minute. Sie liegt im Speicher dieses Prozesses und ist damit
  richtig, solange compute mit einem Arbeiter läuft — siehe den Hinweis im
  Modulkopf dort.

Welche Adresse zählt, entscheidet der **letzte** Eintrag in `X-Forwarded-For`,
und nur, wenn die direkte Gegenstelle aus einem vertrauten Netz kommt: Caddy
hängt hinten an, ein Aufrufer kann vorne erfinden, aber nicht entfernen.

## Der Takt der Tafel

Auf eine Tafel passen zwei Kacheln. Bei mehr Personen wird geblättert — und
der Player hängt `?duration=<sekunden>` an, womit er **eine Seite** meint, nicht
die ganze Anzeige. Ist die letzte Seite abgelaufen, meldet sich die Seite mit

```js
window.parent.postMessage({ type: "embed-cycle-complete" }, "*")
```

Darauf hört `IframePlayer.tsx` im Repo `acm-signage` und schaltet weiter. Der
Player hat auch eine Notbremse, aber die ist grob — ohne die Meldung stünde die
Tafel zu lange auf derselben Anzeige.

Nachgeladen wird stur alle fünf Minuten. Eine Tafel läuft wochenlang durch,
ohne dass jemand das Fenster anfasst; ohne festen Takt stünde am Montag noch
die Woche von vorletztem Freitag.

## Einrahmen muss erlaubt sein

Caddy setzt für die ganze Plattform `X-Frame-Options: SAMEORIGIN`. Der
Signage-Stack läuft in einem eigenen Compose-Projekt auf einem eigenen Port,
also einem anderen Origin — der Rahmen im Player bliebe leer.

Deshalb zwei Kopfzeilenblöcke statt einem: `header @ohne_anzeigen` (alles außer
`/embed/*`) setzt `X-Frame-Options` wie bisher, `header /embed/*` setzt
stattdessen `Content-Security-Policy: frame-ancestors`, vorbelegt mit `*`.

**Nicht per Löschen weiter unten.** Der naheliegende Weg — `-X-Frame-Options`
im `handle`-Block der Anzeigen — wirkt nicht: Caddy schreibt die Kopfzeile des
allgemeinen Blocks erst beim Hinausschreiben der Antwort, also nach dem
Löschen. Auch `defer` ändert daran nichts; nachgemessen, die Kopfzeile stand
danach weiter da.

Vertretbar ist das offene `*`, weil diese Seiten keine Bedienelemente tragen
(Clickjacking hat nichts zu greifen) und ihre Daten ohnehin am Token hängen.
Wer die Herkunft der Tafeln kennt, stellt enger:

```
EMBED_FRAME_ANCESTORS="'self' http://signage.acm.local:8080"
```

## Fallen

- **`EMBED_SECRET` fehlt** → es lässt sich weder ein Token erzeugen noch einer
  prüfen; die Einstellungsseite meldet 503, die Tafeln 403. Das ist Absicht:
  ein zufälliges Geheimnis beim Start hieße, dass jeder Neustart alle Tafeln
  abhängt.
- **Die Seiten liegen außerhalb von `(app)`.** `src/proxy.ts` lässt `/embed/`
  ausdrücklich ohne Sitzung durch. Ein Umzug unter `(app)` leitete sie auf die
  Anmeldung um — auf einer Tafel, vor der niemand steht.
- **Kein `computeFetch`.** Der hängt ein Bearer-Token aus der Supabase-Sitzung
  an, das es hier nicht gibt. `src/lib/anzeige.ts` ruft mit nacktem `fetch`.
- **Das Bild kann keinen Kopf setzen.** `<img>` trägt den Token deshalb im
  Abfrageteil — dieselbe Form, die der Signage-Player für seine Medien nutzt.
- **„Leer" heißt: die Abfrage ist durch und hat nichts geliefert.** Beim Prüfen
  im Browser stand bei einem abgelehnten Token „Zuletzt hat niemand
  angefangen" — die Liste *war* ja leer. Auf einem Flurbildschirm sieht ein
  kaputter Token damit aus wie eine ruhige Woche, und niemand merkt es. Der
  Zustand kommt deshalb als **ein** Wert in die Tafel (`zustandAus()`), nicht
  als drei Schalter nebeneinander.
- **Ein abgelehnter Token wird nicht wiederholt.** Er wird beim dritten Mal
  auch nicht richtig, und solange nachgefasst wird, steht „Einen Moment" auf
  der Tafel statt der Ursache. `lohntNochmal()` lässt nur Serverfehler und
  ausgefallene Verbindungen nachfassen. Verschärft wird das dadurch, dass
  Chrome die Zeitgeber einer nicht sichtbaren Seite bremst: die Wiederholung
  kam im Test minutenlang nicht, und die Tafel hing im Ladezustand fest.
