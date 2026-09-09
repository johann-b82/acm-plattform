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

```bash
docker build --target test services/compute       # Unit-Tests compute
cd apps/web && npm run lint && npm run build       # Web
bash scripts/ci/check_log_hygiene.sh
bash scripts/ci/check_service_role.sh
```

## Rechte prüfen

```bash
TOKEN=$(curl -s "http://localhost/supabase/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"..."}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
curl -s http://localhost/api/me -H "Authorization: Bearer $TOKEN"
# → {"sub": "...", "email": "...", "apps": {"platform": "admin"}}
```

## Zurücksetzen (nur lokal)

```bash
docker compose down -v
rm -rf infra/supabase/upstream/volumes/db/data
```
