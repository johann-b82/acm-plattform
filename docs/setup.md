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

Danach: http://localhost → Login → Launcher. Der Admin sieht alle Apps und die Verwaltung unter `/platform`.

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

Gesichert werden `public`, `auth` und `storage`: die Fachdaten, die Anmeldedaten und die Dateien. Alles andere legt das Supabase-Abbild beim Start selbst an. `pg_dump` läuft im Datenbank-Container, damit Werkzeug und Server dieselbe Version haben; der Abzug wird mit `pg_restore --list` geprüft, bevor er seinen endgültigen Namen bekommt.

Der Job ist **nicht eingeplant** (Entscheidung F: vorbereiten, nicht anwenden). Auf dem Host zum Beispiel so:

```
30 2 * * * cd /srv/acm && ./scripts/backup.sh /srv/acm/backups >> /var/log/acm-backup.log 2>&1
```

### Zurückspielen

```bash
docker compose up -d db                                  # frischer Stack: Rollen und Schemata entstehen beim Start
docker compose exec -T db pg_restore -U postgres -d postgres --clean --if-exists < backups/acm-<datum>.dump
docker compose restart rest                              # PostgREST-Schema-Cache
```

Sieben Meldungen sind dabei normal und ohne Folgen: „schema public already exists“ und einige „permission denied to change default privileges“ zu Supabase-eigenen Rollen. Geprüft wurde der Weg gegen eine leere Datenbank: alle Tabellen, alle Zeilen und alle zehn Policies kamen zurück.

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

### Zugriff vom Browser aus

- **Lesen** geht direkt über PostgREST (`supabaseBrowser()`), die Zeilen-Policies filtern.
- **Schreiben und Rechnen in Python** geht über `computeFetch` an `/api/*`; das Access-Token wird aus der Sitzung angehängt.
- **Signage** geht über den Route Handler `/api/signage/*`, weil dieser Stack auf einem eigenen Port läuft.

Die öffentlichen Supabase-Werte werden zur Laufzeit vom App-Layout an die Provider gereicht, nicht über `NEXT_PUBLIC_*` ins Bundle gebacken. So läuft dasselbe Image auf jedem Host.
