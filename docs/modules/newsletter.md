# Newsletter

Eine Ausgabe je Quartal, online lesbar unter `/newsletter` und als PDF, gepflegt
unter `/newsletter/redaktion`.

## Was anders ist als im Altprojekt

**Kapitel sind Zeilen, keine Konstante.** `lumeapps` hat sechs Rubriken als
Tupel im Code (`NEWSLETTER_RUBRIKEN`). Weil das zu starr war, kamen zwei
JSONB-Spalten dazu, die es überschreiben — `block_reihenfolge` für die
Reihenfolge, `rubrik_titel` für die Namen — plus ein eigener Weg für
ausgabe-eigene Kapitel und zwei Schlüssel, an denen Verhalten hängt: `"kpi"`
wird aus der Reihenfolge gefiltert und vor `"intern"` eingeschoben,
`"menschen"` bekommt die Neuzugänge vorangestellt.

Hier ist ein Kapitel eine Zeile mit `titel`, `sortierung` und `art`. Damit
fallen beide Überschreibungsspalten weg, der Sonderweg fällt weg, und aus den
zwei verhaltenstragenden Schlüsseln wird ein Feld:

| `art` | zeigt |
|---|---|
| `eintraege` | Überschrift, Markdown und Bilder |
| `kpi` | die eingefrorenen Belegschaftszahlen |
| `neuzugaenge` | die eingefrorenen Neuzugänge des Quartals |

**Ein Eintrag hat eine Bilderliste, kein Einzelbild daneben.** Das Altprojekt
hat beides: `bild_data` am Eintrag und zusätzlich `newsletter_eintrag_bild`
fürs Raster. Ein Raster mit einem Bild deckt den Einzelfall ab.

**Bilder liegen im Speicher, nicht in der Zeile.** Im Altprojekt stecken sie
als `bytea` in drei Tabellen. Die Regeln, die dabei gelten, stehen in
[`feedback.md`](feedback.md) — dort war der Speicher zuerst dran.

## Was eine Ausgabe zeigt, friert sie ein

Belegschaftszahlen und Neuzugänge stammen aus `personio_employees`. Diese
Tabelle dreht sich weiter, und ein Newsletter-Leser darf sie nicht sehen. Eine
Ausgabe vom letzten Quartal darf beides also nicht live nachschlagen — sie soll
sagen, was sie damals sagte. Beides steht als `stand` (JSONB) am Kapitel.

Zwei Funktionen füllen es, beide `security definer` und beide mit eigener
Rechteprüfung, weil sie an Daten kommen, die der Aufrufer sonst nicht sähe:

| Funktion | verlangt |
|---|---|
| `newsletter_kpi_einfrieren(kapitel)` | `newsletter: editor` **und** ein `kpi`-Recht |
| `newsletter_neuzugaenge_einfrieren(kapitel)` | `newsletter: editor` **und** ein `hr`-Recht |

Die Schranken sind verschieden, weil die Quellen es sind: die
Belegschaftszahlen sind Aggregate und hängen wie überall an `app_level('kpi')`
(so prüft es `kpi_hr_belegschaft` selbst); die Namen der Neuzugänge sind keine
Aggregate und verlangen dasselbe Recht wie die Tabelle, aus der sie kommen.

Jahr und Quartal kommen aus der Ausgabe, nicht vom Aufrufer — eine Ausgabe
zeigt die Zahlen ihres eigenen Quartals, und niemand soll ein anderes
hineinschreiben können.

Der Stand kennt drei Zustände, und die Redaktion sieht alle drei: `null` heißt
nie eingefroren, eine leere Liste heißt eingefroren und im Quartal kam niemand
dazu, sonst steht die Zahl da. Die beiden ersten gleich zu behandeln hieße, die
Redaktion klickte weiter auf „Einfrieren" und fragte sich, warum nichts
passiert.

Kein Geburtsdatum, kein Foto: das war Befund 4 im Altprojekt, und ein
Newsletter braucht beides nicht.

## Rechte

| | Recht |
|---|---|
| Veröffentlichte Ausgabe lesen | ein `newsletter`-Recht |
| Entwurf sehen, alles bearbeiten | `newsletter: editor` |

Kapitel, Einträge und Bilder wiederholen die Lesebedingung nicht, sie fragen
ihren Elternteil (`exists (select 1 from ...)`). Sonst gäbe es zwei Orte, an
denen steht, wer eine Ausgabe sehen darf, und einer liefe irgendwann hinterher.

## Das PDF

Entsteht im Browser aus der Leseransicht: jede Seite trägt `data-seite`, wird
einzeln mit `html-to-image` zu einem JPEG gerendert und mit `jsPDF` als eigene
A4-Seite gesetzt. So beginnt jedes Kapitel auf einer neuen Seite, statt
mittendurch geschnitten zu werden.

`compute` kommt nicht vor. Die Bestandsaufnahme (`docs/inventory.md`) hatte
„Newsletter-PDF bleibt compute" vorgesehen; im Altprojekt läuft es aber bereits
im Browser (`frontend/src/lib/newsletterPdf.ts`), und ein Weg über den Server
hieße, das gerenderte Layout ein zweites Mal nachzubauen.

JPEG statt PNG ist bewusst: jsPDF legt PNGs praktisch unkomprimiert ab. Im
Altprojekt ergab das bei neun Seiten in doppelter Auflösung ein PDF von über
200 MB — groß genug, um den Tab-Speicher zu sprengen und den Download stumm
scheitern zu lassen.

Gemessen dauert eine A4-Seite rund sechs Sekunden, fünf Seiten also eine halbe
Minute. Deshalb zählt der Knopf mit („Seite 2 von 5 …"): eine halbe Minute ohne
Rückmeldung sieht aus wie ein Fehler.

## Bilder in der Ansicht

Der Eimer `newsletter` ist nicht öffentlich, jedes Bild braucht also eine
signierte URL. Einzeln wäre das eine Anfrage je Bild, und eine Ausgabe hat
leicht zwanzig — `createSignedUrls` erledigt alle mit einer, gültig 30 Minuten
(`bild-urls.tsx`).

Das Raster (`lib/newsletter/puzzle.ts`) packt Bilder mit Zellenspanne dicht in
vier Spalten. Wichtig ist, dass es deterministisch ist: das PDF entsteht aus der
gerenderten Ansicht, und ein Raster, das bei jedem Rendern anders fällt, ergäbe
ein anderes PDF als die Seite davor. Fünf Tests halten das fest.

## Keine Prüfung magischer Bytes

Der Eimer lässt nur Bildtypen zu, und Caddy setzt `X-Content-Type-Options:
nosniff` für den ganzen Ursprung, also auch für `/supabase/storage/*`. Wer eine
HTML-Datei als `image/png` ablegt, bekommt ein Bild, das sich nicht anzeigen
lässt — ausgeführt wird es nicht. Dieselbe Begründung wie Befund 13 in
`docs/security-findings.md`.
