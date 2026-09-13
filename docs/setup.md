# Setup

## Voraussetzungen

Docker Engine mit Compose v2.20+ (`include`, `!override`), Node 22+ und npm nur für die lokale Entwicklung von `apps/web`, `openssl` und `python3` für die Skripte.

## Erststart

```bash
bash infra/supabase/fetch-upstream.sh "$(cat infra/supabase/UPSTREAM_TAG)"   # Supabase docker/ gepinnt nach infra/supabase/upstream/
bash scripts/init-env.sh                                                      # .env mit allen Secrets
docker compose up -d --build                                                  # Supabase + migrate + compute + web + caddy
bash scripts/bootstrap-admin.sh admin@example.com '<sicheres Passwort>'       # Break-Glass-Admin in "Plattform-Admins"
```

Danach: http://localhost → Login → Launcher. Der Admin sieht alle Apps; alles Einstellbare liegt unter `/einstellungen`, nach Bereich gruppiert — die Seite gehört der Plattform-Verwaltung.

`SITE_URL`, `SUPABASE_PUBLIC_URL` und `API_EXTERNAL_URL` in `.env` auf den echten Hostnamen setzen, bevor der Stack auf dem Host läuft. `API_EXTERNAL_URL` ist der JWT-Issuer; `compute` prüft ihn.

## Was läuft wo

| Dienst | Erreichbar | Zweck |
|---|---|---|
| caddy | `:80` | einziger Host-Port; `/` → web, `/api/*` → compute, `/supabase/*` → kong |
| web | intern `:3000` | Next.js standalone |
| compute | intern `:8000` | FastAPI; `/api/health`, `/api/me` |
| kong | `127.0.0.1:8000` | Supabase-Gateway; Studio unter `http://127.0.0.1:8000` mit `DASHBOARD_USERNAME/PASSWORD` (auf dem Host per SSH-Tunnel) |
| db | `127.0.0.1:5432` | Postgres 17 (Supabase-Image), User `postgres` |
| auth, rest, storage, realtime, meta, imgproxy, studio | intern | Supabase |
| functions, supavisor | nicht gestartet (Profil `unused`) | Edge Functions und Pooler werden nicht betrieben |

## Migrationen

`services/compute/alembic/` ist alleiniger DDL-Eigentümer von `public.*`. Der Dienst `migrate` läuft bei jedem `docker compose up` vor `compute`. Neue Revision:

```bash
docker compose run --rm migrate alembic revision -m "beschreibung"
docker compose run --rm migrate alembic upgrade head
```

Migrationen sind SQL-first (`op.execute`), damit RLS-Policies, Funktionen und Grants im selben Commit wie die Tabelle liegen.

## Tests und Guards

Genau die Befehle, die auch CI fährt:

```bash
docker compose -f docker-compose.test.yml run --rm --build compute-test   # compute, gegen eine echte Test-Datenbank
cd apps/web && npm run lint && npm test && npm run build                   # web
bash scripts/ci/check_log_hygiene.sh
bash scripts/ci/check_service_role.sh
```

`docker build --target test services/compute` baut nur das Test-Abbild, es führt nichts aus. Und ohne Datenbank überspringt pytest die Hälfte der Prüfungen stillschweigend — deshalb immer über `docker-compose.test.yml`, das die Test-Datenbank mitbringt. Der Riegel in `tests/conftest.py` bricht ab, wenn `POSTGRES_DB` nicht nach einer Test-Datenbank aussieht.

## Rechte prüfen

```bash
TOKEN=$(curl -s "http://localhost/supabase/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"..."}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
curl -s http://localhost/api/me -H "Authorization: Bearer $TOKEN"
# → {"sub": "...", "email": "...", "apps": {"platform": "admin"}}
```

## Sicherung

```bash
scripts/backup.sh [zielverzeichnis]     # Standard: ./backups, 14 Tage Aufbewahrung
```

Der Lauf legt **zwei** Dateien an, weil die Plattform an zwei Orten liegt:

| Datei | Inhalt |
|---|---|
| `acm-<datum>.dump` | `public`, `auth` und `storage`: Fachdaten, Anmeldedaten, Verzeichnisse der Dateien |
| `acm-<datum>-dateien.tar.gz` | die Dateien selbst, aus dem Volume `speicher` |

Alles andere legt das Supabase-Abbild beim Start selbst an. `pg_dump` läuft im Datenbank-Container, damit Werkzeug und Server dieselbe Version haben; der Abzug wird mit `pg_restore --list` geprüft, bevor er seinen endgültigen Namen bekommt, der `tar` mit `tar -tzf`.

Der zweite Teil ist nicht optional. Das Schema `storage` hält nur die Zeilen zu den Objekten — ein Abzug allein ergäbe Verweise auf Dateien, die es nicht mehr gibt. Der `tar` läuft mit GNU tar und `--xattrs`, weil der Speicher-Dienst Inhaltstyp und Cache-Vorgabe als erweiterte Attribute an der Datei ablegt; das busybox-tar des Speicher-Abbilds nähme sie nicht mit.

Der Job ist **nicht eingeplant** (Entscheidung F: vorbereiten, nicht anwenden). Auf dem Host zum Beispiel so:

```
30 2 * * * cd /srv/acm && ./scripts/backup.sh /srv/acm/backups >> /var/log/acm-backup.log 2>&1
```

### Zurückspielen

```bash
docker compose up -d db                                  # frischer Stack: Rollen und Schemata entstehen beim Start
docker compose exec -T db pg_restore -U postgres -d postgres --clean --if-exists < backups/acm-<datum>.dump
docker compose restart rest                              # PostgREST-Schema-Cache

# Die Dateien zurück ins Volume — ohne sie zeigen die Zeilen ins Leere.
docker run --rm -i -v acm_speicher:/daten alpine sh -c \
    'apk add -q tar && tar --xattrs --xattrs-include="user.*" -xzf - -C /daten' \
    < backups/acm-<datum>-dateien.tar.gz
```

Sieben Meldungen sind dabei normal und ohne Folgen: „schema public already exists“ und einige „permission denied to change default privileges“ zu Supabase-eigenen Rollen. Geprüft wurde der Weg gegen eine leere Datenbank: alle Tabellen, alle Zeilen und alle zehn Policies kamen zurück.

## Datenübernahme aus lumeapps

Drei Läufe, alle wiederholbar und alle zuerst trocken machbar. Sie lesen aus der alten Datenbank und schreiben in die neue; die alte wird nicht verändert.

### Vorbereitung: die beiden Stacks sehen einander nicht

Alt und neu liegen in getrennten Docker-Netzen. Für die Dauer der Übernahme den Compute-Dienst ins alte Netz hängen:

```bash
docker network connect lumeapps_default acm-compute-1
# … Läufe …
docker network disconnect lumeapps_default acm-compute-1
```

Der Verbindungsstring zeigt dann auf den Containernamen der alten Datenbank, nicht auf einen Host-Port:

```
postgresql://<user>:<passwort>@lumeapps-db-1:5432/<datenbank>
```

### Lauf 1: Vertriebsdaten

```bash
docker compose exec compute python -m app.cli uebernahme-vertrieb --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-vertrieb --quelle "$QUELLE"
```

Übernommen werden Upload-Protokolle der Sorten `revenues` und `auftraege` sowie die Tabellen `revenues` und `auftraege`. Alle anderen Protokollsorten meldet der Lauf und lässt sie liegen — sie kommen mit ihrem jeweiligen Modul.

Die alten Protokoll-Ids werden **nicht** übernommen; die neue Tabelle vergibt sie selbst, und die Fremdschlüssel werden dabei umgeschrieben. `uploaded_by` bleibt leer, weil die alte Tabelle nicht weiß, wer hochgeladen hat.

### Lauf 2: Personen

```bash
docker compose exec compute python -m app.cli uebernahme-nutzer --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-nutzer --quelle "$QUELLE" > zugaenge.csv
```

Passwörter sind nicht portierbar: Directus und GoTrue speichern sie mit verschiedenen Verfahren. Jede Person bekommt deshalb ein neues, zufälliges Passwort, und der Lauf gibt die Liste **genau einmal** als CSV aus. Wegschreiben, verteilen, Datei löschen.

Gesperrte Konten (`status != active`) kommen nicht mit: wer nicht aktiv war, soll nicht durch die Übernahme wieder Zugang bekommen.

Von den Rechten kommt nur die Zugehörigkeit zur Gruppe `Plattform-Admins` mit, und zwar für die alte Rolle `Administrator`. Alles andere wird nicht geraten, sondern unter `/einstellungen#zugaenge` gesetzt: die alte Welt kannte drei Rollen für die ganze Anwendung, die neue vergibt Rechte je App.

### Lauf 3: ATR-Teilekatalog und Vorlagen

```bash
docker compose exec compute python -m app.cli uebernahme-atr --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-atr --quelle "$QUELLE"
```

Holt `atr_part` in den Teilekatalog und `atr_template` in die Vorlagen, samt der
Gerüstdateien, die dabei in den Eimer `atr` wandern. Der Abgleich läuft über die
normierte Teilenummer, der Lauf ist also wiederholbar.

Dieser Lauf ist nicht optional: der Katalog muss vollständig sein, sonst findet
ein Lieferschein seine Teile nicht. Die Produktion führt 287 Teile aus neun
Referenzmappen — eine einzelne Mappe neu einzulesen reicht nicht.

Steht in der alten Zeile kein Programm (`ac_programme` leer), nimmt der Lauf den
Dateinamen des Gerüsts. So heißt die Vorlage hinterher nach dem Programm, für
das sie gilt, und nicht „—".

### Danach prüfen

```bash
docker compose exec db psql -U postgres -d postgres -c \
  "select kind, count(*) from upload_batches group by kind;"
docker compose exec db psql -U postgres -d postgres -c \
  "select count(*) as personen from auth.users;"
docker compose exec db psql -U postgres -d postgres -c \
  "select count(*) as teile from atr_teile;"
```

Verifiziert am 2026-09-09 gegen eine echte Alt-Datenbank (Schema aus 125 Alembic-Revisionen, Directus 11.17.2 mit `directus_users` und `directus_roles`): Sorten- und Statusabbildung, Umschreiben der Fremdschlüssel, übersprungene Protokollsorten, gesperrte Konten, Gruppenzuordnung, Anmeldung einer übernommenen Person mit dem ausgegebenen Passwort. Beide Läufe zweimal hintereinander ausgeführt, ohne Dubletten.

### Was hier noch nicht drin ist

Alles, was zu einem Modul gehört, das noch nicht portiert ist — HR, Qualität, Produktion, ATR, FAIR, Newsletter. Und die Signage-Daten: die liegen im eigenen Repo, Checkliste in `acm-signage/docs/setup.md`.

## Zurücksetzen (nur lokal)

```bash
docker compose down -v
rm -rf infra/supabase/upstream/volumes/db/data
```

## Signage-Verwaltung

Die Oberfläche für Digital Signage liegt unter `/signage` (App-Kachel `signage`, verlangt `signage: admin`). Sie spricht **nicht** direkt mit dem Signage-Stack, sondern über einen Route Handler der Web-App:

```
Browser  ──/api/signage/*──►  Caddy  ──►  web (Route Handler)  ──►  SIGNAGE_API_URL/api/signage/*
                                              hängt das Access-Token an
```

Damit bleibt der Browser same-origin (kein CORS, kein Token an einen fremden Origin), die Netze der beiden Compose-Projekte bleiben getrennt, und der Signage-Stack prüft das Token weiterhin selbst. `SIGNAGE_API_URL` zeigt vom Container aus auf den Host-Port des Signage-Caddy (Standard `http://host.docker.internal:8080`).

Player und Raspberry Pis nutzen diesen Weg nicht — sie sprechen direkt mit dem Signage-Stack. Eine ausgefallene Plattform lässt die Bildschirme unberührt.

Nicht übernommen aus dem Altprojekt: die Live-Vorschau im Playlist-Editor (rotierender Player) und der Admin-SSE-Kanal für Änderungen aus anderen Sitzungen. Der Editor zeigt stattdessen die Reihenfolge mit Vorschaubildern; Listen aktualisieren sich über TanStack Query (30 s bei Geräten, nach jeder Änderung sofort).

## Fachmodule

### Vertrieb (Referenz für alle weiteren Module)

Der Vertriebs-Strang ist vollständig umgesetzt und zeigt, wie die übrigen Module gebaut werden:

| Schritt | Ort | Warum dort |
|---|---|---|
| ERP-Datei einlesen | `services/compute/app/parsing/vertrieb.py` | Deutsche Zahlen, Latin-1, Eigenheiten je Export — das bleibt Python |
| Import | `POST /api/uploads/{umsatz,auftraege}` | Upsert auf die Vorgangsnummer, Größenprüfung beim Lesen, Parsen im Thread |
| Tabellen und Rechte | Alembic `0002_vertrieb` | Alembic ist alleiniger DDL-Eigentümer, Policies stehen in derselben Revision |
| Kennzahlen | SQL-Funktionen `kpi_vertrieb_*` | Eine Abfrage statt einer Schleife über Zeitfenster |
| Anzeige | `apps/web/src/app/(app)/kpi/vertrieb` | Ruft die Funktionen über PostgREST auf, RLS entscheidet über die Sichtbarkeit |

Rechte: `kpi` zum Ansehen der Kennzahlen, `uploads: admin` zum Einlesen der Dateien. Ein Nutzer ohne `kpi` sieht keine Zeilen und damit Nullwerte, kein Fehler.

Ein neues Modul folgt demselben Weg: Parser und Upload-Route in compute, Tabelle mit Policy in einer Alembic-Revision, Rechenweg als SQL-Funktion, Seite unter `apps/web`.

### Einkauf (zweites Modul, nach demselben Muster gebaut)

Liefertermintreue der Lieferanten. Ein Upload (`dev_excel_Liefertreue_Einkauf.txt`), drei SQL-Funktionen (`kpi_einkauf_otd`, `_verlauf`, `kpi_einkauf_positionen`), eine Seite unter `/kpi/einkauf`.

Drei Stellen, an denen der Rechenweg sich nicht von selbst versteht und die deshalb je einen eigenen Test haben:

- Das Fenster liegt auf dem **Ist-Lieferdatum**, nicht auf dem Zieltermin. Gezählt wird, was im Zeitraum angekommen ist.
- Pünktlich heißt `Verzug ≤ 0`, nicht `= 0`. Eine frühe Lieferung ist pünktlich.
- Eine Position **ohne** Verzugswert zählt im Nenner der Quote mit und drückt sie, geht aber nicht in den Mittelwert ein. Sie kann nie pünktlich sein, verzerrt aber den Durchschnitt nicht.

Der Zielwert von 98 % steht als Konstante im Frontend, wie im Altprojekt. Er wandert in die Einstellungen, sobald dieses Modul portiert ist.

### Produktion (drittes Modul)

Aufträge in Verzug. Zwei Uploads, weil zwei Dateien nötig sind: die Auftragspositionen tragen den Zieltermin, die Lieferscheine das Ist-Datum. Die Lieferscheine kommen als Excel-Datei.

Der Rechenweg liegt in der Sicht `auftrag_verzug`, damit ihn die drei Funktionen darüber nicht dreimal beschreiben. Vier Regeln, die man beim Lesen des SQL leicht übersieht:

- Der Zieltermin eines Auftrags ist das **späteste** Lieferdatum seiner Positionen.
- Gezählt wird nur, wenn der Ausgang feststeht: geliefert **oder** Termin verstrichen. Ein offener Auftrag mit Termin in der Zukunft ist weder pünktlich noch verspätet und taucht nirgends auf.
- Ein offener, überfälliger Auftrag zählt als verspätet. Sein Verzug wächst täglich weiter, auch für abgeschlossene Zeiträume.
- Eine einzige frühe Teillieferung macht den Auftrag „geliefert". Das ist eine Schwäche der Quelldaten, keine der Rechnung, und in der Oberfläche nicht zu erkennen.

Zwei bewusste Abweichungen vom Altprojekt: „Alles" rechnet hier wirklich über alles, statt still auf den laufenden Monat zurückzufallen. Und der wirkungslose Seriengeschäft-Filter ist nicht mitgekommen; die Spalte `pos_typ_2` schon, damit er später ohne Migration nachrüstbar ist.

### Qualität (viertes Modul, erster Teil)

Audit-Findings aus den 8D-Berichten. Die Datei enthält Audits **und** Reklamationen; beide werden übernommen, denn die Reklamationsquote kommt als nächster Teil und soll nicht denselben Upload noch einmal verlangen.

Die eine Stelle, an der die Quelle überrascht: das Level eines Befunds steht nicht in einer Spalte, sondern im Freitext „Artikel" — „Audit Major Level 1" oder „Audit Minor Level 2". Der Parser leitet es ab. Steht dort etwas anderes, bleibt das Level leer, der Befund zählt in keiner Kachel und erscheint in der Diagnoseliste. Ohne diese Liste bliebe unsichtbar, dass ein Bericht falsch beschriftet ist.

Gelöschte Berichte sind in der Quelle nicht entfernt, sondern mit `gelöscht = J` markiert; sie kommen nicht mit.

Die Höchstwerte (0 für Level 1, 5 für Level 2) stehen als Konstanten im Frontend. Sie wandern in die Einstellungen, sobald dieses Modul portiert ist.

### Zielwerte

Drei Kennzahlen trugen ihren Zielwert als Konstante im Frontend, weil die Einstellungen des Altprojekts noch nicht portiert sind. Jede weitere Kennzahl mit Ziellinie wäre die vierte gewesen.

Statt des 67-spaltigen Singletons aus dem Altprojekt gibt es eine Zeile je Zielwert. Der Unterschied ist praktisch: ein neues Modul fügt eine Zeile ein, statt eine Migration mit einer neuen Spalte zu brauchen, und die Oberfläche rendert alle Zielwerte über einen Kamm.

| Eigenschaft | Bedeutung |
|---|---|
| `einheit` | `anteil` steht als Bruch in der Spalte (0.98), die Oberfläche zeigt und nimmt Prozent |
| `richtung` | `min` heißt: weniger als das Ziel ist schlecht (Liefertreue). `max` heißt umgekehrt (Verzug) |

Lesen darf, wer die Kennzahlen sieht — ohne Zielwert fehlt der Kachel die Einordnung. Ändern darf, wer mindestens `editor` auf den Einstellungen hat. Dafür gibt es `public.app_mindestens(app, stufe)`; die bisherigen Policies prüften nur `is not null`, was zum Lesen genügt, zum Schreiben aber nicht.

Neue Zielwerte kommen aus Migrationen, nicht aus der Oberfläche: die Tabelle gibt kein `insert`-Recht. Ein Zielwert gehört zu einer Kennzahl, und die entsteht im Code.

### Reklamationsquote (On Quality)

Der Zähler steht schon in `quality_records` — die 8D-Datei enthält Audits und Reklamationen. Neu ist der Nenner.

| Art | Bezugsgröße |
|---|---|
| Kunde | gelieferte Menge |
| intern | ebenfalls die **Kunden**lieferungen — eine andere gibt es nicht |
| Material-Lieferanten | Wareneingänge ohne die Warengruppen DIENST und SERVIC |
| Werkbänke | Wareneingänge genau dieser beiden Warengruppen |

Eine leere Warengruppe zählt zum Material, nicht zur Dienstleistung.

Zähler und Nenner haben **verschiedene Datumsfelder**: eine Reklamation kann in einem anderen Zeitraum liegen als die Lieferung, auf die sie sich bezieht. Das ist im Altprojekt so und bleibt so. Wird der Nenner dadurch zu klein, meldet die Karte es ausdrücklich, statt eine unsinnige Quote zu zeigen.

Die Datenbank liefert die Fehlerquote, die Oberfläche zeigt `1 − Quote` als „On Quality". Die Umkehrung passiert an einer Stelle.

**Stolperstein bei SQL-Funktionen:** ein Parameter, der wie eine Spalte heißt, wird zur Spalte aufgelöst. `art text` neben `quality_records.art` ließ die Funktion still null zählen. Parameter tragen deshalb ein `p_`.

### Prüfmengen

Die Kennzahl heißt „Produkte je Tag und Mitarbeiter". Vier Eigenheiten:

- Der Nenner ist **gemeinsam** über beide Größenklassen: Prüfer mal Prüftage. Dieselben Leute prüfen an denselben Tagen große und kleine Produkte.
- Gerundet wird **zur geraden Zahl**, wie Pythons `round()` (2,5 → 2; 3,5 → 4). Postgres rundet die Hälfte sonst vom Nullpunkt weg, und einzelne Kacheln wichen um eins vom Altprojekt ab. Dafür gibt es `public.runde_zur_geraden(numeric)`.
- Ohne Prüfer oder Prüftage steht **0** in der Kachel, kein Strich.
- Nur `rsc = '70000'` ist eine echte Qualitätsprüfung. Alles andere ist eine Sonderbuchung und zählt weder im Zähler noch im Nenner — bleibt aber in der Tabelle, damit sichtbar ist, was gebucht wurde.

Die Größenklasse steht nicht in den Daten, sondern folgt einer Regel über Produktgruppe und Bezeichnung. Sie wird beim Einlesen abgeleitet; dreizehn Parametrisierungen decken die Regeln ab, darunter, dass „Internet" nicht als Netztasche zählt.

**Dieser Upload ersetzt, statt zu aktualisieren.** Die Quelle hat keinen Geschäftsschlüssel — zwei gleiche Buchungszeilen sind erlaubt. Alle Zeilen im Datumsbereich der Datei werden gelöscht, dann kommen die neuen. Von Hand abgewählte Buchungen in diesem Bereich zählen danach wieder mit; ohne Schlüssel lässt sich das nicht sauber vermeiden, und die Upload-Karte sagt es.

### Materialkostenquote

Vier Entscheidungen des Rechenwegs, alle aus dem Altprojekt übernommen:

- **Die Preisliste ist fensterunabhängig.** Auch eine Auswertung über den Januar rechnet mit dem jüngsten bekannten Preis.
- **Der Preis kommt aus Wert geteilt durch Menge**, nicht aus der Preisspalte der Datei. Die kann sich je nach Artikel auf 100 oder 1000 Stück beziehen.
- **Ein Artikel ohne Preis wird nicht mit null bewertet**, sondern ausgelassen und gezählt. Sonst sähe die Quote besser aus, als sie ist. Die Kachel „Artikel ohne Preis" macht das sichtbar.
- **Mehr Storno als Entnahme ergibt negative Kosten.** Kein Schutzgriff: das Vorzeichen ist eine Aussage über die Daten.

Wie im Altprojekt wird `AswKpf_WE.txt` **zweimal** hochgeladen: als Wareneingang (Reklamationsquote) und als Materialpreise (Wareneingang) in die eigene Tabelle `material_prices`. Die Sicht `artikel_preise` liest nur die Materialpreise — die beiden Uploads haben verschiedene Stände (Migration `0043_materialpreise`).

### Ladenhüter

Diese Kennzahl weicht von allen anderen ab, und darin liegen die Fallstricke:

- **Der Zeitraum des Dashboards gilt nicht.** Stichtag ist immer heute. Ein Bestand ist ein Stichtagswert; was im März im Regal lag, sagt der Bewegungsverlauf nicht.
- **Kein Buchtyp-Filter.** Jede Bewegung zählt, auch Zugänge — der Bestand ist die Summe über alles.
- Nur Artikelnummern, die mit `L` beginnen, sind Lagerartikel.
- Ohne Preiszeile fällt ein Artikel still heraus. Anders als bei der Materialkostenquote gibt es hier keine Quote, die dadurch geschönt würde.

Die Preise kommen aus einer **eigenen** Preisliste, nicht aus den Wareneingängen: ein Lagerartikel muss nie eingekauft worden sein, er kann aus der eigenen Fertigung kommen. Der Upload ersetzt die ganze Liste, nicht nur die enthaltenen Artikel — sonst blieben Preise für Artikel stehen, die es nicht mehr gibt.

### Eine Migration nachträglich ändern

Solange eine Revision noch nicht gemerged ist, lässt sie sich bearbeiten. Die Testdatenbank merkt das aber nicht: ihr Container läuft zwischen den Läufen weiter und Alembic überspringt die bereits eingetragene Revision. Vorher zurücksetzen:

```bash
docker compose -f docker-compose.test.yml down -v
```

### Zugriff vom Browser aus

- **Lesen** geht direkt über PostgREST (`supabaseBrowser()`), die Zeilen-Policies filtern.
- **Schreiben und Rechnen in Python** geht über `computeFetch` an `/api/*`; das Access-Token wird aus der Sitzung angehängt.
- **Signage** geht über den Route Handler `/api/signage/*`, weil dieser Stack auf einem eigenen Port läuft.

Die öffentlichen Supabase-Werte werden zur Laufzeit vom App-Layout an die Provider gereicht, nicht über `NEXT_PUBLIC_*` ins Bundle gebacken. So läuft dasselbe Image auf jedem Host.
