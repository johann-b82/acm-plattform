# Supabase self-hosted (Phase 2)

Grundlage ist das offizielle Verzeichnis `docker/` aus `supabase/supabase`, gepinnt auf einen Tag. Es wird **nicht** eingecheckt, sondern per `fetch-upstream.sh` nach `infra/supabase/upstream/` geholt. Eigene Anpassungen leben in `docker-compose.override.yml` (ab Phase 2), damit ein Upstream-Update ein Diff bleibt.

Geplante Abweichungen vom Upstream:

| Upstream | Hier | Grund |
|---|---|---|
| `analytics` (Logflare), `vector` | deaktiviert | eigenes Log-Volumen, eigene DB; widerspricht `docs/logging.md` |
| Kong auf `0.0.0.0:8000` | nur intern; Plattform-Caddy routet `/supabase/*` | Same-Origin, keine offenen Host-Ports |
| Studio auf `:3000` | nur `127.0.0.1` oder Caddy mit Basic-Auth | Entwicklerwerkzeug |
| Volumes unter `./volumes` | `/srv/acm/{db,storage}` | getrennt vom Signage-Stack |
| kein `logging` | `x-logging`-Anker auf jedem Dienst | CI-Guard |
| `db` ohne `pg_cron`-Jobs | Retention-Jobs per Alembic-Migration angelegt | `compute` bleibt zustandslos |

Vorgehen in Phase 2:

1. `bash fetch-upstream.sh <tag>` (Tag beim Start verifizieren).
2. `.env` aus `../../.env.example` erzeugen, Schlüssel nach Supabase-Anleitung generieren.
3. Override anlegen, `docker compose -f upstream/docker-compose.yml -f docker-compose.override.yml config` prüfen.
4. Custom Access Token Hook (`apps`-Claim) als SQL-Funktion in einer Alembic-Migration, in GoTrue per `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*` registrieren.
